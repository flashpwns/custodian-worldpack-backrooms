"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
};
const stable = (value) => `${JSON.stringify(canonicalize(value), null, 2)}\n`;
const states = ["unreviewed", "triaged", "source-verified", "claim-extracted", "canon-reviewed", "admitted", "rejected", "superseded", "needs-context"];
const relations = ["supports", "contradicts", "qualifies", "supersedes", "contextualizes", "duplicates", "derived-from"];
function data() {
  const registry = read("canon/source-registry.json");
  const claims = read("canon/claims/foundation.json").claims;
  return { registry, claims, sourceIds: new Set(registry.sources.map(({ id }) => id)), claimById: new Map(claims.map((claim) => [claim.id, claim])) };
}
function admission(dependency, claim) {
  if (!claim) return { ok: false, code: "MISSING_CLAIM" };
  if (claim.simulation_authority === "prohibited") return { ok: false, code: "PROHIBITED_CLAIM" };
  if (dependency.use === "reference") return ["canon-reviewed", "admitted", "needs-context", "superseded"].includes(claim.review_state) ? { ok: true, code: "REFERENCE_ALLOWED" } : { ok: false, code: "REFERENCE_NOT_REVIEWED" };
  if (claim.review_state !== "admitted") return { ok: false, code: "CLAIM_NOT_ADMITTED" };
  const accepted = { "authoritative-world-state": ["authoritative"], "interpretive-default": ["authoritative", "interpretive-default"], "scenario-optional": ["authoritative", "interpretive-default", "scenario-optional"], reference: ["authoritative", "interpretive-default", "scenario-optional", "experimental", "reference-only"] };
  return accepted[dependency.use]?.includes(claim.simulation_authority) ? { ok: true, code: "ADMITTED" } : { ok: false, code: "INSUFFICIENT_AUTHORITY" };
}
module.exports = { root, read, stable, states, relations, data, admission };
