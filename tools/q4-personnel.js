"use strict";

const history = require("./world-history");
const crypto = require("node:crypto");
const spatialRuntime = require("./spatial-runtime");
const personnelGeneration = require("./personnel-generation");
const continuity = require("./q4-personnel-continuity");
const VERSION = "yellow-beast-q4-personnel@v2";

// Conservative operational identities for the bounded Q4 experience. These
// are procedural personnel records, not canon-character claims or biographies.
// These records exist only to identify and preserve already-established v1
// saves. New staffing never selects them by name or identity.
const LEGACY_PERSONNEL = Object.freeze({
  legacyPlayer: { identity: "yb-field-player", first_name: "Alex", last_name: "Morgan", role: "field surveyor", clearance: "field", condition: "normal" },
  alex: { identity: "yb-field-alex-morgan", first_name: "Alex", last_name: "Morgan", role: "field surveyor", clearance: "field", condition: "normal" },
  peer: { identity: "yb-field-peer-observer", first_name: "Nora", last_name: "Vale", role: "survey technician", clearance: "field", condition: "normal" }
});
const DEFAULTS = LEGACY_PERSONNEL;

function displayName(person) { return person?.display_name ?? [person?.first_name, person?.last_name].filter(Boolean).join(" "); }
function identityFor(first_name, last_name) { return `q4-player-${crypto.createHash("sha256").update(`${first_name.trim().toLowerCase()}|${last_name.trim().toLowerCase()}`).digest("hex").slice(0, 16)}`; }
function createPlayer(world, { first_name, last_name, display_name = null } = {}) {
  const first = typeof first_name === "string" ? first_name.trim() : "";
  const last = typeof last_name === "string" ? last_name.trim() : "";
  if (!/^[A-Za-z][A-Za-z' -]{1,39}$/.test(first) || !/^[A-Za-z][A-Za-z' -]{1,59}$/.test(last)) return { ok: false, code: "PLAYER_NAME_INVALID" };
  world.q4_operations ??= { institutional_time: 0, last_review: null };
  if (world.q4_operations.controlled_player) {
    const existing = history.character(world, world.q4_operations.controlled_player);
    return existing ? { ok: true, created: false, player: safePerson(existing) } : { ok: false, code: "PLAYER_RECORD_INCONSISTENT" };
  }
  const identity = identityFor(first, last);
  const created = ensure(world, "personnel-creation", { identity, first_name: first, last_name: last, display_name: display_name?.trim() || `${first} ${last}`, role: "field researcher", clearance: "Q4", condition: "normal", classification: "q4-player-personnel", provenance: "user-created-personnel-record", authority: "institutional-personnel-record" });
  world.q4_operations.controlled_player = created.identity;
  world.q4_operations.player_created_at = { event: "personnel-record-created" };
  return { ok: true, created: true, player: safePerson(created) };
}
function safePerson(person) { return person ? { identity: person.identity, first_name: person.first_name, last_name: person.last_name, display_name: displayName(person), role: person.role, clearance: person.clearance, condition: person.condition, status: person.status, current_assignment: person.current_assignment, assignment_history: person.assignment_history ?? [], qualifications: person.continuity?.qualifications ?? continuity.qualifications(person), death: person.status === "dead" ? person.death : null } : null; }
function ensure(world, run_id, spec) {
  const existing = history.character(world, spec.identity);
  if (existing) return continuity.ensurePerson(world, run_id, spec.identity);
  const created = history.instantiateCharacter(world, { run_id, ...spec, display_name: displayName(spec), classification: "q4-procedural-personnel", provenance: "q4-operational-staffing" });
  if (!created.ok) throw Object.assign(new Error("Q4 personnel identity unavailable"), { code: created.code });
  return continuity.ensurePerson(world, run_id, spec.identity);
}
function assign(world, run_id, person, assignment) {
  if (!person || person.status === "dead") return { ok: false, code: "PERSONNEL_UNAVAILABLE" };
  const next = { id: assignment.id, role: assignment.role, expedition_id: assignment.expedition_id, assigned_at: assignment.assigned_at ?? null };
  person.current_assignment = next;
  person.assignment_history ??= [];
  person.assignment_history.push(structuredClone(next));
  history.event(world, run_id, "character.assignment.changed", { identity: person.identity, assignment: next }, person.authority);
  return { ok: true, person };
}
function staffQ4(world, run_id, player_identity = null, seed = "q4", staffing_rules = {}) {
  player_identity ??= world.q4_operations?.controlled_player;
  if (!world.q4_operations?.controlled_player) {
    const assigned = ensure(world, run_id, { identity: player_identity ?? "yb-field-player", first_name: "Field", last_name: "Researcher", display_name: "Field Researcher", role: "field researcher", clearance: "Q4", condition: "normal", generated: false, provenance: "unconfigured-controlled-personnel" });
    world.q4_operations ??= { institutional_time: 0, last_review: null };
    world.q4_operations.controlled_player = assigned.identity;
    player_identity = assigned.identity;
  }
  if (!player_identity) return { ok: false, code: "PLAYER_PERSONNEL_REQUIRED" };
  const playerSpec = world.q4_operations?.controlled_player === player_identity ? history.character(world, player_identity) : null;
  if (!playerSpec) return { ok: false, code: "PLAYER_PERSONNEL_REQUIRED" };
  const player = ensure(world, run_id, playerSpec);
  if (player.status === "dead") return { ok: false, code: "PLAYER_PERSONNEL_DECEASED" };
  world.q4_operations ??= { institutional_time: 0, last_review: null };
  world.q4_operations.generated_rosters ??= {};
  let coworkerIds = world.q4_operations.generated_rosters[seed];
  const requiredCoworkers = Number.isInteger(staffing_rules.total) ? staffing_rules.total - 1 : null;
  const requiredRoles = requiredCoworkers !== null && Array.isArray(staffing_rules.coworker_roles) ? staffing_rules.coworker_roles.slice(0, requiredCoworkers) : null;
  const rosterUnavailable = (ids) => {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || (requiredCoworkers !== null && ids.length !== requiredCoworkers)) return true;
    const people = ids.map((id) => history.character(world, id));
    if (people.some((person) => person?.status !== "active")) return true;
    return requiredRoles ? requiredRoles.some((role) => !people.some((person) => person.role === role)) : false;
  };
  if (rosterUnavailable(coworkerIds)) {
    // Existing active records are the first staffing pool. New generation only
    // fills a genuine gap, preserving a career's identities across shifts.
    const sharedWork = (person) => (person.continuity?.shared_history ?? []).filter((fact) => fact.kind === "served-together" && fact.participants?.includes(player.identity)).length;
    const immediatePriorRoster = new Set(world.q4_operations.last_roster ?? []);
    const returningPriority = (person) => sharedWork(person) > 0 && !immediatePriorRoster.has(person.identity) ? 1 : 0;
    const established = Object.values(world.characters ?? {}).filter((person) => person.identity !== player.identity && person.status === "active" && person.role && person.clearance && /q4-|field|survey|documentation/i.test(`${person.classification ?? ""} ${person.role}`)).sort((a, b) => returningPriority(b) - returningPriority(a) || sharedWork(b) - sharedWork(a) || a.identity.localeCompare(b.identity));
    const roleSet = new Set(established.map((person) => person.role));
    if (requiredRoles?.length === requiredCoworkers && requiredRoles.every((role) => roleSet.has(role))) {
      coworkerIds = requiredRoles.map((role) => established.find((person) => person.role === role).identity);
    } else if (!requiredRoles && established.length >= 2 && roleSet.has("survey technician") && roleSet.has("documentation specialist")) {
      const required = ["survey technician", "documentation specialist"].map((role) => established.find((person) => person.role === role));
      coworkerIds = [...required, ...established.filter((person) => !required.includes(person))].slice(0, requiredCoworkers ?? 3).map((person) => person.identity);
    }
    for (let attempt = 0; attempt < 32; attempt += 1) {
      if (!rosterUnavailable(coworkerIds)) break;
      const generationSeed = attempt === 0 && !Array.isArray(coworkerIds) ? seed : `${seed}:restaff:${attempt + 1}`;
      const generated = personnelGeneration.generate({ seed: generationSeed, world_id: world.world_id, player: safePerson(player), staffing: staffing_rules });
      const selectedExisting = new Set();
      const candidateIds = generated.coworkers.map((spec) => {
        const compatible = requiredRoles ? established.find((person) => person.role === spec.role && !selectedExisting.has(person.identity)) : null;
        if (compatible) { selectedExisting.add(compatible.identity); return compatible.identity; }
        return ensure(world, run_id, { ...spec, classification: "q4-generated-personnel", provenance: "seeded-operational-staffing", authority: "institutional-personnel-record" }).identity;
      });
      if (!rosterUnavailable(candidateIds)) { coworkerIds = candidateIds; break; }
    }
    if (rosterUnavailable(coworkerIds)) return { ok: false, code: "Q4_TEAM_UNAVAILABLE" };
    world.q4_operations.generated_rosters[seed] = [...coworkerIds];
  }
  const coworkers = coworkerIds.map((id) => history.character(world, id)).filter((person) => person?.status === "active" && person.identity !== player.identity);
  if (coworkers.length < 2 || coworkers.length > 4 || (requiredCoworkers !== null && coworkers.length !== requiredCoworkers)) return { ok: false, code: "Q4_TEAM_UNAVAILABLE" };
  assign(world, run_id, player, { id: "clear-q4-field-survey-alpha", expedition_id: "clear-q4-field-survey-alpha", role: player.role });
  for (const coworker of coworkers) assign(world, run_id, coworker, { id: "clear-q4-field-survey-alpha", expedition_id: "clear-q4-field-survey-alpha", role: coworker.role });
  continuity.ensureTeam(world, run_id, [player, ...coworkers]);
  continuity.recordSharedHistory(world, { run_id, participants: [player.identity, ...coworkers.map((coworker) => coworker.identity)], kind: "served-together", refs: { assignment_id: "clear-q4-field-survey-alpha" }, at: world.q4_operations?.institutional_time ?? 0 });
  world.q4_operations.controlled_player = player.identity;
  world.q4_operations.last_roster = [...coworkerIds];
  const safeCoworkers = coworkers.map(safePerson);
  return { ok: true, player: safePerson(player), peer: safeCoworkers[0], assistant: safeCoworkers[1], coworkers: safeCoworkers, team: [safePerson(player), ...safeCoworkers], generation: { version: personnelGeneration.VERSION, seed, total: coworkers.length + 1 } };
}
function cryptoScore(value) { let total = 0; for (const char of JSON.stringify(value)) total = (total * 33 + char.charCodeAt(0)) % 1000003; return total; }
function selectSuccessor(world, run_id, seed = "succession") {
  world.q4_operations ??= { institutional_time: 0, last_review: null };
  const former = world.q4_operations.controlled_player ?? LEGACY_PERSONNEL.legacyPlayer.identity;
  const candidates = [...new Set(Object.values(world.q4_operations.generated_rosters ?? {}).flat())].map((id) => history.character(world, id)).filter((person) => person && person.identity !== former && person.status === "active" && person.role && person.clearance);
  const next = candidates.sort((a, b) => cryptoScore([seed, a.identity]) - cryptoScore([seed, b.identity]) || a.identity.localeCompare(b.identity))[0];
  if (!next) return { ok: false, code: "SUCCESSOR_UNAVAILABLE" };
  world.q4_operations.controlled_player = next.identity;
  history.event(world, run_id, "q4.player.succession", { former, former_status: "dead", successor: next.identity, handover: "explicit-operational-control-transfer" }, "recorded-world-history-only");
  return { ok: true, former, successor: safePerson(next), handover: { former, final_status: "dead", former_status: "dead", new_controlled_person: next.identity, role: next.role, clearance: next.clearance, institutional_context: "future Clear-Q4 operations continue under a different assigned person" } };
}
function teamMember(person, role, expedition_id) {
  return { id: person.identity, personnel_id: person.identity, first_name: person.first_name, last_name: person.last_name, display_name: displayName(person), role, status: "active", contact_category: "NEARBY", observed_condition: "appears-normal", last_contact: "assigned", assignment: { id: expedition_id, role } };
}
function observerStatus(member, person, phase = "FIELD_OPERATION", spatial = null, observer = null) {
  if (!member) return { contact_category: "CONTACT LOST", condition: "Unknown", local_eligible: false, last_contact: "not currently confirmed" };
  const contactLost = ["dead", "missing", "unavailable", "unknown"].includes(person?.status);
  if (contactLost) return { contact_category: "CONTACT LOST", condition: "Unknown", local_eligible: false, last_contact: member.last_contact ?? "not currently confirmed" };
  if (member.status !== "active") return { contact_category: member.contact_category ?? "CONTACT LOST", condition: member.observed_condition === "appears-normal" ? "Appears normal" : (member.observed_condition ?? "Unknown"), local_eligible: false, last_contact: member.last_contact ?? "not currently confirmed" };
  if (spatial && observer) {
    const relationship = spatialRuntime.proximity(spatial, observer, member.personnel_id ?? member.id);
    return { contact_category: relationship.category, condition: member.observed_condition === "appears-normal" ? "Appears normal" : (member.observed_condition ?? "Appears normal"), local_eligible: relationship.speaking_range, last_contact: relationship.speaking_range ? "visually confirmed now" : member.last_contact ?? "last confirmed position", location: relationship.subject_location, proximity: relationship };
  }
  const restricted = ["SEPARATED", "REMOTE", "CONTACT LOST", "UNKNOWN"].includes(member.contact_category);
  const contact = ["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK", "FIELD_OPERATION"].includes(phase) ? (restricted ? member.contact_category : "LOCAL") : (restricted ? member.contact_category : "NEARBY");
  return { contact_category: contact, condition: member.observed_condition === "appears-normal" ? "Appears normal" : (member.observed_condition ?? "Appears normal"), local_eligible: contact === "LOCAL", last_contact: member.last_contact ?? "current" };
}
function publicTeam(run, phase = "FIELD_OPERATION", world = null) {
  const controlled = run.session?.startup?.player?.observer_id ?? null;
  return (run.expedition?.team?.members ?? []).map((member) => {
    const fallback = member.id === LEGACY_PERSONNEL.peer.identity ? LEGACY_PERSONNEL.peer : member.id === LEGACY_PERSONNEL.alex.identity ? LEGACY_PERSONNEL.alex : member.id === LEGACY_PERSONNEL.legacyPlayer.identity ? LEGACY_PERSONNEL.legacyPlayer : member;
    const person = world ? (history.character(world, member.personnel_id ?? member.id) ?? fallback) : (member.personnel ?? fallback);
    const observed = observerStatus(member, person, phase, run.spatial, controlled);
    const isUser = Boolean(member.personnel_id === controlled);
    const known = member.last_known_status ?? {};
    return { id: member.personnel_id ?? member.id, personnel_id: member.personnel_id ?? member.id, display_name: `${member.display_name ?? displayName(person)}${isUser ? " · YOU" : ""}`, first_name: member.first_name ?? person.first_name, last_name: member.last_name ?? person.last_name, role: `${member.role}${isUser ? " · YOU" : ""}`, clearance: person.clearance ?? null, assignment: person.current_assignment ?? member.assignment ?? null, contact_category: observed.contact_category, condition: observed.local_eligible || isUser ? observed.condition : known.condition ?? "Unknown", last_contact: observed.last_contact, location: observed.local_eligible || isUser ? observed.location ?? run.spatial?.personnel_locations?.[member.personnel_id ?? member.id] ?? null : known.location ?? null, local_eligible: observed.local_eligible, controlled: isUser };
  });
}

module.exports = { VERSION, DEFAULTS, LEGACY_PERSONNEL, displayName, safePerson, createPlayer, identityFor, staffQ4, selectSuccessor, assign, teamMember, observerStatus, publicTeam };
