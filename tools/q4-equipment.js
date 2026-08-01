"use strict";

const history = require("./world-history");
const VERSION = "yellow-beast-q4-equipment@v2";
const REQUIRED = Object.freeze(["field-light", "recording-device", "survey-instrument", "survey-radio"]);
const OPTIONAL = Object.freeze(["field-notebook", "spare-film", "route-marker-kit"]);
const DEFINITIONS = Object.freeze({
  "field-light": { type: "battery-lamp", label: "Battery field lamp", model: "handheld battery lamp", capability: "illumination", consumable: { kind: "battery condition", remaining: "checked" } },
  "recording-device": { type: "35mm-camera", label: "35mm field camera", model: "manual 35mm documentation camera", capability: "photographic documentation", consumable: { kind: "film exposures", remaining: 12 } },
  "survey-instrument": { type: "portable-survey-instrument", label: "Portable survey instrument", model: "portable measurement instrument", capability: "qualitative measurement", consumable: { kind: "battery condition", remaining: "checked" } },
  "survey-radio": { type: "field-radio", label: "Handheld field radio", model: "short-range field radio", capability: "radio communication", consumable: { kind: "battery condition", remaining: "checked" } },
  "field-notebook": { type: "field-notebook", label: "Field notebook", model: "bound paper field notebook", capability: "written notes", consumable: { kind: "pages", remaining: "available" } },
  "spare-film": { type: "35mm-film", label: "Spare film roll", model: "35mm documentation film", capability: "photographic documentation", consumable: { kind: "film exposures", remaining: 24 } },
  "route-marker-kit": { type: "route-marker-kit", label: "Numbered route-marker kit", model: "adhesive numbered survey tabs", capability: "route marking", consumable: { kind: "numbered tabs", remaining: 4 } }
});
const clone = (value) => structuredClone(value);
// Display fallback for migrated v1 saves only; new holders are resolved from
// the persisted generated roster supplied to projection().
const LEGACY_HOLDER_NAMES = Object.freeze({ "yb-field-peer-observer": "Nora Vale", "yb-field-alex-morgan": "Alex Morgan" });
function makeId(world, key) { const entries = Object.keys(world?.q4_equipment ?? {}).filter((id) => id.startsWith(`q4-${key}-`)); return `q4-${key}-${String(entries.length + 1).padStart(2, "0")}`; }
function createItem(world, key, { owner, holder, container = "field case", location = "staging locker", id = null } = {}) {
  const definition = DEFINITIONS[key]; if (!definition) throw new Error(`unknown Q4 equipment type: ${key}`);
  return { id: id ?? makeId(world, key), type: definition.type, label: definition.label, model: definition.model, period_authority: "1985-1995-compatible operational equipment", assigned_to: owner, holder, container, location, state: "operational", known_condition: "Operational", capability: definition.capability, consumable: clone(definition.consumable), charges: key === "survey-radio" ? 2 : typeof definition.consumable.remaining === "number" ? definition.consumable.remaining : 1, used: 0, history: [{ event: "issued", holder, location }] };
}
function characterAvailable(world, identity) { const person = history.character(world, identity); return !person || !["dead", "missing", "unavailable"].includes(person.status); }
function ensureWorldItem(world, run_id, key, player, preferredId = null) {
  world.q4_equipment ??= {};
  const existing = preferredId ? world.q4_equipment[preferredId] : Object.values(world.q4_equipment).find((item) => item.type === DEFINITIONS[key].type && item.holder === player && ["operational", "serviceable"].includes(item.state) && characterAvailable(world, item.holder));
  if (existing && existing.state !== "abandoned" && existing.state !== "missing") return existing;
  const item = createItem(world, key, { owner: player, holder: player, id: preferredId && !world.q4_equipment[preferredId] ? preferredId : null });
  world.q4_equipment[item.id] = item;
  history.event(world, run_id, "q4.equipment.issued", { equipment_id: item.id, type: item.type, holder: item.holder, location: item.location });
  return item;
}
function prepare(world, run_id, { player, peer = null, assistant = null, coworkers = [], required_keys = REQUIRED }) {
  const required = Object.fromEntries(required_keys.map((key) => [key, clone(ensureWorldItem(world, run_id, key, player))]));
  const optional = Object.fromEntries(OPTIONAL.map((key) => { const id = `q4-${key}-stores`; world.q4_equipment ??= {}; world.q4_equipment[id] ??= createItem(world, key, { owner: "q4-stores", holder: "q4-stores", container: "optional stores", location: "staging locker", id }); return [key, clone(world.q4_equipment[id])]; }));
  const people = coworkers.length ? coworkers : [peer, assistant].filter(Boolean);
  const roleHolder = (pattern, fallback = player) => people.find((person) => pattern.test(String(person.role ?? "")))?.identity ?? people.find((person) => typeof person === "string") ?? fallback;
  const holders = { "field-light": player, "recording-device": roleHolder(/documentation/i), "survey-instrument": roleHolder(/survey technician/i), "survey-radio": player };
  for (const [key, item] of Object.entries(required)) { const holder = holders[key] ?? player; item.assigned_to = holder; item.holder = holder; item.container = "field case"; item.location = "staging locker"; if (holder !== player) item.history.push({ event: "assigned-to-team-member", holder, location: item.location }); }
  return { required, optional, player, peer: holders["survey-instrument"], assistant: holders["recording-device"], coworkers: people.map((person) => person.identity ?? person) };
}
function expeditionEquipment(loadout, player) {
  const values = loadout?.required ?? {};
  if (Object.keys(values).length) return clone(values);
  return Object.fromEntries(REQUIRED.map((key) => [key, createItem(null, key, { owner: player, holder: player })]));
}
function updatePhase(expedition, phase) {
  const staging = phase === "STAGING";
  for (const item of Object.values(expedition.equipment ?? {})) { item.location = staging ? "staging locker" : "with the field kit"; item.container = staging ? "field case" : "field kit"; }
  expedition.loadout ??= {};
  expedition.loadout.phase = phase;
  return expedition;
}
function stateUsable(item) { return Boolean(item && ["operational", "serviceable", "usable"].includes(item.state) && !["missing", "abandoned", "depleted", "damaged", "jammed"].includes(item.state)); }
function use(expedition, key, holder) {
  const item = expedition.equipment?.[key];
  if (!item || item.holder !== holder) return { ok: false, code: "EQUIPMENT_NOT_ACCESSIBLE" };
  if (!stateUsable(item) || item.charges <= 0) return { ok: false, code: "EQUIPMENT_UNAVAILABLE" };
  item.charges -= 1; item.used = (item.used ?? 0) + 1;
  if (typeof item.consumable?.remaining === "number") item.consumable.remaining = Math.max(0, item.consumable.remaining - 1);
  if (item.charges <= 0) item.state = "depleted";
  item.history ??= []; item.history.push({ event: "used", holder, remaining: item.charges, state: item.state });
  return { ok: true, item };
}
function transfer(expedition, key, from, to, location = "with the field kit") {
  const item = expedition.equipment?.[key]; if (!item) return { ok: false, code: "EQUIPMENT_UNKNOWN" };
  if (item.holder !== from) return { ok: false, code: "EQUIPMENT_NOT_ACCESSIBLE" };
  if (!stateUsable(item)) return { ok: false, code: "EQUIPMENT_UNAVAILABLE" };
  item.holder = to; item.assigned_to = to; item.location = location; item.history ??= []; item.history.push({ event: "handed-over", from, to, location }); return { ok: true, item: clone(item) };
}
function selectOptional(expedition, key, holder) {
  const item = expedition.optional_stores?.[key];
  if (!item || item.holder !== "q4-stores") return { ok: false, code: "OPTIONAL_STORE_UNAVAILABLE" };
  item.holder = holder; item.assigned_to = holder; item.container = "field case"; item.location = "staging locker"; item.history ??= []; item.history.push({ event: "selected-from-stores", holder, location: item.location }); expedition.equipment[key] = item; delete expedition.optional_stores[key]; return { ok: true, item: clone(item) };
}
function syncWorld(world, expedition) { if (!world || !expedition?.equipment) return; world.q4_equipment ??= {}; for (const item of Object.values(expedition.equipment)) world.q4_equipment[item.id] = clone(item); }
function publicItem(item, player, known = true, holderNames = {}, context = {}) {
  const own = item.holder === player; const actualState = stateUsable(item) ? (item.known_condition ?? "Operational") : String(item.state ?? "unavailable").replace(/(^|[-_])\w/g, (part) => part.replace(/[-_]/, " ").toUpperCase()); const state = known ? actualState : "Unknown condition";
  const stores = item.holder === "q4-stores";
  const names = { ...LEGACY_HOLDER_NAMES, ...holderNames };
  const holderStatus = context.personnel_status?.[item.holder];
  const missing = ["dead", "missing", "unavailable", "unknown"].includes(holderStatus?.status);
  const sameLocation = own || stores || (!missing && Boolean(context.spatial && context.observer && context.spatial.personnel_locations?.[item.holder] && context.spatial.personnel_locations[item.holder] === context.spatial.personnel_locations[context.observer]));
  const separated = !own && !stores && !sameLocation;
  const radioConfirmed = separated && context.radio_confirmed_holders?.includes(item.holder);
  const observerState = sameLocation ? state : radioConfirmed ? state : item.known_condition === "Operational" ? "Last observed operational" : "Unknown condition";
  const verification = own || sameLocation ? "visually confirmed" : radioConfirmed ? "confirmed over radio" : missing ? "holder missing" : item.state === "abandoned" ? "abandoned" : separated ? "last known" : "unknown";
  const location = stores ? item.location : own || sameLocation ? "carrying" : context.spatial?.last_confirmed_personnel_positions?.[item.holder]?.location ? "last confirmed with holder" : "location unknown";
  return { id: item.id, category: item.type, label: item.label, model: item.model, holder: own ? "You" : stores ? "Team stores" : names[item.holder] ?? "Assigned teammate", location, state: observerState, verification, capability: item.capability, consumable: own || stores || sameLocation || radioConfirmed ? clone(item.consumable) : { kind: item.consumable?.kind ?? "operational measure", remaining: "Unknown" }, available: (own || stores || sameLocation) && stateUsable(item) };
}
function projection(expedition, player, holderNames = {}, context = {}) { const items = Object.entries(expedition.equipment ?? {}); return { required: items.map(([ref, item]) => ({ ...publicItem(item, player, true, holderNames, context), ref })), optional: Object.entries(expedition.optional_stores ?? {}).map(([ref, item]) => ({ ...publicItem(item, player, true, holderNames, context), ref })), readiness: items.every(([, item]) => stateUsable(item)), missing: items.filter(([, item]) => !stateUsable(item)).map(([, item]) => item.label) }; }
module.exports = { VERSION, REQUIRED, OPTIONAL, DEFINITIONS, prepare, expeditionEquipment, updatePhase, stateUsable, use, transfer, selectOptional, syncWorld, publicItem, projection };
