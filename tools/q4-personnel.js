"use strict";

const history = require("./world-history");
const VERSION = "yellow-beast-q4-personnel@v1";

// Conservative operational identities for the bounded Q4 experience. These
// are procedural personnel records, not canon-character claims or biographies.
const DEFAULTS = Object.freeze({
  player: { identity: "yb-field-player", first_name: "Alex", last_name: "Morgan", role: "field surveyor", clearance: "field", condition: "normal" },
  peer: { identity: "yb-field-peer-observer", first_name: "Nora", last_name: "Vale", role: "survey partner", clearance: "field", condition: "normal" },
  relief: [
    { identity: "yb-field-relief-01", first_name: "Mara", last_name: "Ellis", role: "survey partner", clearance: "field", condition: "normal" },
    { identity: "yb-field-relief-02", first_name: "Jonah", last_name: "Price", role: "survey partner", clearance: "field", condition: "normal" }
  ]
});

function displayName(person) { return person?.display_name ?? [person?.first_name, person?.last_name].filter(Boolean).join(" "); }
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
function staffQ4(world, run_id, player_identity = DEFAULTS.player.identity) {
  const playerSpec = player_identity === DEFAULTS.player.identity ? DEFAULTS.player : { ...DEFAULTS.player, identity: player_identity };
  const player = ensure(world, run_id, playerSpec);
  if (player.status === "dead") return { ok: false, code: "PLAYER_PERSONNEL_DECEASED" };
  const candidates = [DEFAULTS.peer, ...DEFAULTS.relief].map((spec) => history.character(world, spec.identity) ?? ensure(world, run_id, spec)).filter((person) => person.status === "active");
  const peer = candidates[0];
  if (!peer) return { ok: false, code: "Q4_TEAM_UNAVAILABLE" };
  assign(world, run_id, player, { id: "clear-q4-field-survey-alpha", expedition_id: "clear-q4-field-survey-alpha", role: player.role });
  assign(world, run_id, peer, { id: "clear-q4-field-survey-alpha", expedition_id: "clear-q4-field-survey-alpha", role: peer.role });
  return { ok: true, player: safePerson(player), peer: safePerson(peer) };
}
function teamMember(person, role, expedition_id) {
  return { id: person.identity, personnel_id: person.identity, first_name: person.first_name, last_name: person.last_name, display_name: displayName(person), role, status: "active", contact_category: "NEARBY", observed_condition: "appears-normal", last_contact: "assigned", assignment: { id: expedition_id, role } };
}
function observerStatus(member, person, phase = "FIELD_OPERATION") {
  const contactLost = ["dead", "missing", "unavailable", "unknown"].includes(person?.status);
  if (contactLost) return { contact_category: "CONTACT LOST", condition: "Unknown", local_eligible: false, last_contact: member.last_contact ?? "not currently confirmed" };
  if (member.status !== "active") return { contact_category: member.contact_category ?? "CONTACT LOST", condition: member.observed_condition === "appears-normal" ? "Appears normal" : (member.observed_condition ?? "Unknown"), local_eligible: false, last_contact: member.last_contact ?? "not currently confirmed" };
  const restricted = ["SEPARATED", "REMOTE", "CONTACT LOST", "UNKNOWN"].includes(member.contact_category);
  const contact = phase === "FIELD_OPERATION" ? (restricted ? member.contact_category : "LOCAL") : (restricted ? member.contact_category : "NEARBY");
  return { contact_category: contact, condition: member.observed_condition === "appears-normal" ? "Appears normal" : (member.observed_condition ?? "Appears normal"), local_eligible: contact === "LOCAL", last_contact: member.last_contact ?? "current" };
}
function publicTeam(run, phase = "FIELD_OPERATION", world = null) {
  return (run.expedition?.team?.members ?? []).map((member) => {
    const fallback = member.id === DEFAULTS.peer.identity ? DEFAULTS.peer : member.id === DEFAULTS.player.identity ? DEFAULTS.player : member;
    const person = world ? (history.character(world, member.personnel_id ?? member.id) ?? fallback) : (member.personnel ?? fallback);
    const observed = observerStatus(member, person, phase);
    return { display_name: member.display_name ?? displayName(person), first_name: member.first_name ?? person.first_name, last_name: member.last_name ?? person.last_name, role: member.role, clearance: person.clearance ?? null, assignment: person.current_assignment ?? member.assignment ?? null, contact_category: observed.contact_category, condition: observed.condition, last_contact: observed.last_contact, local_eligible: observed.local_eligible };
  });
}

module.exports = { VERSION, DEFAULTS, displayName, safePerson, staffQ4, assign, teamMember, observerStatus, publicTeam };
