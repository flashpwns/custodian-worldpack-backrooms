"use strict";

const crypto = require("node:crypto");
const defaultPools = require("../data/personnel-name-pools.json");

const VERSION = "yellow-beast-personnel-generation@v1";
const POOL_VERSION = "yellow-beast-personnel-name-pools@v1";

function score(parts) {
  return Number.parseInt(crypto.createHash("sha256").update(parts.map(String).join("\u001f")).digest("hex").slice(0, 12), 16);
}

function validatePools(pools = defaultPools) {
  if (pools?.version !== POOL_VERSION) throw new Error("unsupported personnel name-pool version");
  for (const key of ["first_names", "last_names"]) {
    if (!Array.isArray(pools[key]) || pools[key].length < 500) throw new Error(`${key} must contain at least 500 names`);
    if (new Set(pools[key]).size !== pools[key].length) throw new Error(`${key} contains duplicate values`);
    for (const value of pools[key]) if (typeof value !== "string" || !/^[A-Za-z][A-Za-z' -]{1,59}$/.test(value)) throw new Error(`${key} contains an invalid name`);
  }
  return true;
}

function mergedPools(override = null) {
  validatePools(defaultPools);
  if (!override) return defaultPools;
  const result = {
    version: POOL_VERSION,
    first_names: [...new Set([...defaultPools.first_names, ...(override.first_names ?? [])])],
    last_names: [...new Set([...defaultPools.last_names, ...(override.last_names ?? [])])]
  };
  validatePools(result);
  return result;
}

function staffingCount(seed, staffing = {}) {
  const minimum = Number(staffing.minimum_total ?? 3);
  const maximum = Number(staffing.maximum_total ?? 5);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 3 || maximum > 5 || minimum > maximum) throw new Error("field-team size must be between three and five");
  const declared = staffing.total;
  if (declared !== undefined) {
    if (!Number.isInteger(declared) || declared < minimum || declared > maximum) throw new Error("declared field-team size is outside staffing bounds");
    return declared;
  }
  return minimum + (score([seed, "staffing-count"]) % (maximum - minimum + 1));
}

function generate({ seed, world_id = "standalone", player, staffing = {}, pool_override = null }) {
  const pools = mergedPools(pool_override);
  const total = staffingCount(seed, staffing);
  const roles = staffing.coworker_roles ?? ["survey technician", "documentation specialist", "field safety specialist", "route specialist"];
  if (!Array.isArray(roles) || roles.length < total - 1 || roles.some((role) => typeof role !== "string" || !role.trim())) throw new Error("staffing lacks qualified coworker roles");
  const used = new Set([String(player?.display_name ?? "").trim().toLowerCase()].filter(Boolean));
  const coworkers = [];
  for (let slot = 0; slot < total - 1; slot += 1) {
    let selected = null;
    for (let attempt = 0; attempt < pools.first_names.length * 2; attempt += 1) {
      const first = pools.first_names[(score([seed, world_id, slot, attempt, "first"]) + attempt) % pools.first_names.length];
      const last = pools.last_names[(score([seed, world_id, slot, attempt, "last"]) + attempt * 7) % pools.last_names.length];
      const display = `${first} ${last}`;
      if (!used.has(display.toLowerCase())) { selected = { first, last, display }; break; }
    }
    if (!selected) throw new Error("unable to generate a unique personnel name");
    used.add(selected.display.toLowerCase());
    coworkers.push({
      identity: `yb-personnel-${crypto.createHash("sha256").update(`${world_id}|${seed}|${slot}`).digest("hex").slice(0, 20)}`,
      first_name: selected.first,
      last_name: selected.last,
      display_name: selected.display,
      role: roles[slot],
      clearance: staffing.clearance ?? "field",
      condition: "normal",
      status: "active",
      generated: true,
      generation: { version: VERSION, seed_digest: crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 16), slot }
    });
  }
  return { version: VERSION, total, coworkers };
}

module.exports = { VERSION, POOL_VERSION, validatePools, mergedPools, staffingCount, generate, score };
