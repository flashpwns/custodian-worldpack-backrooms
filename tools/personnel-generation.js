"use strict";

const crypto = require("node:crypto");
const defaultPools = require("../data/personnel-name-pools.json");

const VERSION = "yellow-beast-personnel-generation@v2";
const POOL_VERSION = "yellow-beast-personnel-name-pools@v1";

// Small, durable social anchors. These are intentionally mundane and finite:
// the dialogue layer may express them, but it may not promote them into facts
// about the world or invent a hidden biography around them.
const BASELINE_POOLS = Object.freeze({
  age_band: ["early twenties", "late twenties", "early thirties", "late thirties", "early forties"],
  region: ["Great Lakes", "Mid-Atlantic", "New England", "Gulf Coast", "Upper Midwest", "Appalachia"],
  education_or_trade: ["community-college surveying", "industrial electrical work", "emergency medical training", "technical drafting", "warehouse logistics", "photographic documentation"],
  async_tenure: ["first week", "under six months", "one to two years", "three to five years"],
  social_expression: ["dryly observant", "quietly friendly", "carefully polite", "plain-spoken", "wry under pressure"],
  behavioral_disposition: ["checks details twice", "acts quickly once decided", "keeps close track of the group", "prefers an explicit procedure", "improvises with available tools"],
  tertiary_modifier: [null, "competitive about small tasks", "softens when someone is nervous", "hides uncertainty with jokes", "takes institutional wording literally"],
  conversational_temperament: ["brief and direct", "measured and reflective", "warm but guarded", "talkative when uneasy", "deadpan"],
  mundane_preference: ["coffee left to cool", "window seats", "fresh pencils", "plain doughnuts", "paper maps", "radio baseball"],
  irritation: ["loose equipment straps", "people humming indoors", "smudged paperwork", "late arrivals", "unlabeled keys", "cold coffee"],
  social_tendency: ["asks one practical follow-up", "fills silence with small talk", "lets others speak first", "checks whether everyone heard", "defuses tension with understatement"],
  pre_expedition_concern: ["forgot whether the break-room coffee pot was switched off", "is waiting on a call about a car repair", "left lunch in the wrong refrigerator", "needs to return a borrowed library book", "is worried a parking meter will expire", "promised to pick up groceries after shift"]
});

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

function baselineFor(seed, worldId, slot) {
  const baseline = {};
  for (const [key, values] of Object.entries(BASELINE_POOLS)) {
    baseline[key] = values[score([seed, worldId, slot, key]) % values.length];
  }
  return baseline;
}

function generate({ seed, world_id = "standalone", player, staffing = {}, pool_override = null }) {
  const pools = mergedPools(pool_override);
  const total = staffingCount(seed, staffing);
  const roles = staffing.coworker_roles ?? ["survey technician", "documentation specialist", "field safety specialist", "route specialist"];
  if (!Array.isArray(roles) || roles.length < total - 1 || roles.some((role) => typeof role !== "string" || !role.trim())) throw new Error("staffing lacks qualified coworker roles");
  const used = new Set([String(player?.display_name ?? "").trim().toLowerCase()].filter(Boolean));
  const coworkers = [];
  for (let slot = 0; slot < total - 1; slot += 1) {
    if (Array.isArray(staffing.coworkers) && staffing.coworkers[slot]) {
      const authored = staffing.coworkers[slot];
      const display = authored.display_name ?? `${authored.first_name} ${authored.last_name}`;
      used.add(display.toLowerCase());
      coworkers.push({
        identity: authored.identity ?? `yb-personnel-${crypto.createHash("sha256").update(`${world_id}|${seed}|${slot}`).digest("hex").slice(0, 20)}`,
        first_name: authored.first_name,
        last_name: authored.last_name,
        display_name: display,
        role: authored.role ?? roles[slot],
        clearance: authored.clearance ?? staffing.clearance ?? "field",
        condition: authored.condition ?? "normal",
        status: authored.status ?? "active",
        generated: false,
        authored: true,
        identity_substrate: authored.identity_substrate ?? baselineFor(seed, world_id, slot),
        generation: { version: VERSION, seed_digest: crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 16), slot }
      });
      continue;
    }
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
      identity_substrate: baselineFor(seed, world_id, slot),
      generation: { version: VERSION, seed_digest: crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 16), slot }
    });
  }
  return { version: VERSION, total, coworkers };
}

module.exports = { VERSION, POOL_VERSION, BASELINE_POOLS, validatePools, mergedPools, staffingCount, baselineFor, generate, score };
