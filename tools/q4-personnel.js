"use strict";

const history = require("./world-history");
const crypto = require("node:crypto");
const spatialRuntime = require("./spatial-runtime");
const VERSION = "yellow-beast-q4-personnel@v1";

// Conservative operational identities for the bounded Q4 experience. These
// are procedural personnel records, not canon-character claims or biographies.
const DEFAULTS = Object.freeze({
  legacyPlayer: { identity: "yb-field-player", first_name: "Alex", last_name: "Morgan", role: "field surveyor", clearance: "field", condition: "normal" },
  player: { identity: "yb-field-player", first_name: "Alex", last_name: "Morgan", role: "field surveyor", clearance: "field", condition: "normal" },
  alex: { identity: "yb-field-alex-morgan", first_name: "Alex", last_name: "Morgan", role: "field surveyor", clearance: "field", condition: "normal" },
  peer: { identity: "yb-field-peer-observer", first_name: "Nora", last_name: "Vale", role: "survey technician", clearance: "field", condition: "normal" },
  relief: [
    { identity: "yb-field-relief-01", first_name: "Mara", last_name: "Ellis", role: "survey partner", clearance: "field", condition: "normal" },
    { identity: "yb-field-relief-02", first_name: "Jonah", last_name: "Price", role: "survey partner", clearance: "field", condition: "normal" }
  ]
});

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
function safePerson(person) { return person ? { identity: person.identity, first_name: person.first_name, last_name: person.last_name, display_name: displayName(person), role: person.role, clearance: person.clearance, condition: person.condition, status: person.status, current_assignment: person.current_assignment, assignment_history: person.assignment_history ?? [], death: person.status === "dead" ? person.death : null } : null; }
function ensure(world, run_id, spec) {
  const existing = history.character(world, spec.identity);
  if (existing) return existing;
  const created = history.instantiateCharacter(world, { run_id, ...spec, display_name: displayName(spec), classification: "q4-procedural-personnel", provenance: "q4-operational-staffing" });
  if (!created.ok) throw Object.assign(new Error("Q4 personnel identity unavailable"), { code: created.code });
  return history.character(world, spec.identity);
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
function staffQ4(world, run_id, player_identity = null, seed = "q4") {
  player_identity ??= world.q4_operations?.controlled_player;
  if (!world.q4_operations?.controlled_player && (!player_identity || player_identity === DEFAULTS.legacyPlayer.identity)) {
    const legacy = ensure(world, run_id, DEFAULTS.legacyPlayer);
    world.q4_operations ??= { institutional_time: 0, last_review: null };
    world.q4_operations.controlled_player = legacy.identity;
    player_identity = legacy.identity;
  }
  if (!player_identity) return { ok: false, code: "PLAYER_PERSONNEL_REQUIRED" };
  const playerSpec = world.q4_operations?.controlled_player === player_identity ? history.character(world, player_identity) : null;
  if (!playerSpec) return { ok: false, code: "PLAYER_PERSONNEL_REQUIRED" };
  const player = ensure(world, run_id, playerSpec);
  if (player.status === "dead") return { ok: false, code: "PLAYER_PERSONNEL_DECEASED" };
  const candidates = [DEFAULTS.peer, DEFAULTS.alex, ...DEFAULTS.relief].map((spec) => history.character(world, spec.identity) ?? ensure(world, run_id, spec)).filter((person) => person.status === "active" && person.identity !== player.identity);
  const recentTeams = Object.values(world.q4_missions ?? {}).slice(-3).map((mission) => new Set(mission.assigned_personnel ?? []));
  const ranked = candidates.map((person) => ({ person, score: cryptoScore([seed, person.identity, world.next_run]) + (recentTeams.some((team) => team.has(person.identity)) ? 1000 : 0) })).sort((a, b) => a.score - b.score || a.person.identity.localeCompare(b.person.identity));
  const peer = candidates.find((person) => person.identity === DEFAULTS.peer.identity) ?? (ranked[0] ?? {}).person;
  const legacy = !world.q4_operations?.player_created_at;
  const assistant = legacy ? null : (candidates.find((person) => person.identity === DEFAULTS.alex.identity) ?? ranked.find(({ person }) => person.identity !== peer?.identity)?.person);
  if (!peer || (!legacy && !assistant)) return { ok: false, code: "Q4_TEAM_UNAVAILABLE" };
  assign(world, run_id, player, { id: "clear-q4-field-survey-alpha", expedition_id: "clear-q4-field-survey-alpha", role: player.role });
  assign(world, run_id, peer, { id: "clear-q4-field-survey-alpha", expedition_id: "clear-q4-field-survey-alpha", role: peer.role });
  if (assistant) assign(world, run_id, assistant, { id: "clear-q4-field-survey-alpha", expedition_id: "clear-q4-field-survey-alpha", role: assistant.role });
  world.q4_operations ??= { institutional_time: 0, last_review: null };
  world.q4_operations.controlled_player = player.identity;
  return { ok: true, player: safePerson(player), peer: safePerson(peer), assistant: safePerson(assistant), team: [safePerson(player), safePerson(peer), safePerson(assistant)].filter(Boolean) };
}
function cryptoScore(value) { let total = 0; for (const char of JSON.stringify(value)) total = (total * 33 + char.charCodeAt(0)) % 1000003; return total; }
function selectSuccessor(world, run_id, seed = "succession") {
  world.q4_operations ??= { institutional_time: 0, last_review: null };
  const former = world.q4_operations.controlled_player ?? DEFAULTS.legacyPlayer.identity;
  const candidates = [DEFAULTS.peer, ...DEFAULTS.relief].map((spec) => history.character(world, spec.identity) ?? ensure(world, run_id, spec)).filter((person) => person.identity !== former && person.status === "active" && person.role && person.clearance);
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
    const fallback = member.id === DEFAULTS.peer.identity ? DEFAULTS.peer : member.id === DEFAULTS.alex.identity ? DEFAULTS.alex : member.id === DEFAULTS.legacyPlayer.identity ? DEFAULTS.legacyPlayer : member;
    const person = world ? (history.character(world, member.personnel_id ?? member.id) ?? fallback) : (member.personnel ?? fallback);
    const observed = observerStatus(member, person, phase, run.spatial, controlled);
    const isUser = Boolean(member.personnel_id === controlled);
    return { id: member.personnel_id ?? member.id, personnel_id: member.personnel_id ?? member.id, display_name: `${member.display_name ?? displayName(person)}${isUser ? " · YOU" : ""}`, first_name: member.first_name ?? person.first_name, last_name: member.last_name ?? person.last_name, role: `${member.role}${isUser ? " · YOU" : ""}`, clearance: person.clearance ?? null, assignment: person.current_assignment ?? member.assignment ?? null, contact_category: observed.contact_category, condition: observed.condition, last_contact: observed.last_contact, location: observed.location ?? run.spatial?.personnel_locations?.[member.personnel_id ?? member.id] ?? null, local_eligible: observed.local_eligible, controlled: isUser };
  });
}

module.exports = { VERSION, DEFAULTS, displayName, safePerson, createPlayer, identityFor, staffQ4, selectSuccessor, assign, teamMember, observerStatus, publicTeam };
