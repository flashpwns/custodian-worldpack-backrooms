"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSession, exportSession, restoreSession, stableSerialize, getAvailableSessionActions, submitSessionAction, inspectSessionObserver } = require("custodian");

const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const clone = (value) => structuredClone(value);
const FIELD_PROFILE = "field-researcher";
const FIELD_SCENARIO = "async-field-intro";

function profileFor(profileId) { return read("profiles/profiles.json").profiles.find((profile) => profile.id === profileId); }
function startupFor(profileId) {
  const profile = profileFor(profileId);
  const config = read("profiles/startups.json").startups.find((entry) => entry.profile === profileId);
  if (!profile || !config) throw new Error(`unknown profile: ${profileId}`);
  const knowledge = read("profiles/knowledge.json").profiles.find((entry) => entry.id === profile.starting_knowledge_profile);
  const permissions = read("profiles/permissions.json").sets.find((entry) => entry.id === profile.starting_permissions);
  const resources = read("profiles/resources.json").profiles.find((entry) => entry.id === profile.starting_resource_profile);
  const declared = profileId === FIELD_PROFILE ? ["traverse-controlled-route", "toggle-light"] : [];
  return { profile, startup: { profile: { id: profile.id }, player: config.player, knowledge: [...knowledge.institutional_records, ...config.knowledge.map((entry) => entry.reference)].map((reference, index) => ({ observer_id: config.player.observer_id, kind: config.knowledge[index]?.kind ?? "institutional_record", reference })), permissions: [...permissions.permissions, ...declared].map((permission) => ({ observer_id: config.player.observer_id, permission })), resources: resources.resources.map((id) => ({ id, custodian: config.player.observer_id, quantity: 1 })), metadata: config.metadata } };
}
function configuredScenario(profileId, playerId) {
  const scenario = clone(read("scenarios/threshold-baseline.json"));
  scenario.id = profileId === FIELD_PROFILE ? FIELD_SCENARIO : scenario.id;
  const actorId = `yb-actor-${playerId}`;
  const initialPosition = profileId === FIELD_PROFILE ? "threshold-transition" : profileId === "local-anomaly" ? "complex-side-adjacent-survey-space" : (read("profiles/startups.json").startups.find((entry) => entry.profile === profileId)?.metadata.starting_location);
  scenario.actors = [{ id: actorId, position: initialPosition }];
  scenario.observers.push({ id: playerId, goals: [], plans: [], actor_id: actorId, origin: "embodied", capabilities: ["visual"], access: profileId === FIELD_PROFILE ? ["field-survey"] : [] });
  if (profileId === FIELD_PROFILE) {
    const peerActor = "yb-field-peer-actor";
    scenario.actors.push({ id: peerActor, position: "complex-side-controlled-area" });
    scenario.observers.push({ id: "yb-field-peer-observer", goals: [], plans: [], actor_id: peerActor, origin: "embodied", capabilities: ["visual"], access: ["field-survey"] });
  }
  return scenario;
}
function configuredPack(profileId, playerId) {
  const pack = clone(read("manifest.json"));
  if (profileId === FIELD_PROFILE) {
    const route = pack.execution_rules.find((rule) => rule.intent === "traverse-controlled-route");
    route.success_effects = [{ type: "actors.positioned", domain: "actors", payload: { actor_id: `yb-actor-${playerId}`, position: "complex-side-controlled-area" } }];
    const fieldInteraction = pack.execution_rules.find((rule) => rule.intent === "toggle-light");
    fieldInteraction.preconditions = [...fieldInteraction.preconditions, { path: "resources.recording-device.custodian", equals: playerId }];
  }
  return pack;
}
function newRun({ profile, seed, session }) {
  const profileRecord = profileFor(profile);
  return { version: "yellow-beast-run@v1", profile_id: profile, profile_title: profileRecord.title, scenario: session.scenario.id, seed, session, lifecycle: "active", checklist: { moved: false, inspected: false, used: false }, aliases: {} };
}
function startRun({ profile, seed = "yellow-beast-bootstrap" }) {
  const { profile: profileRecord, startup } = startupFor(profile);
  const player = startup.player.observer_id;
  const result = createSession({ world_pack: configuredPack(profile, player), scenario: configuredScenario(profile, player), startup, seed_material: { seed } });
  if (!result.ok) return result;
  const restored = restoreSession(exportSession(result.session).envelope);
  const run = newRun({ profile, seed, session: result.session });
  return { ok: restored.ok, session: result.session, run, restored_equivalent: restored.ok && stableSerialize(restored.session) === stableSerialize(result.session), summary: { session_id: result.session.id, profile, profile_title: profileRecord.title, scenario: result.session.scenario.id, seed, player: startup.player, knowledge: startup.knowledge, permissions: startup.permissions, resources: startup.resources } };
}
function normalizeRun(value) {
  if (value?.version === "yellow-beast-run@v1") return value;
  if (value?.session) return newRun({ profile: value.session.startup.profile.id, seed: value.session.seed_material?.seed ?? "restored", session: value.session });
  return newRun({ profile: value.startup.profile.id, seed: value.seed_material?.seed ?? "restored", session: value });
}
function look(runValue) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  const result = inspectSessionObserver({ session: run.session, observer, request: { id: `look-${run.session.id}`, kind: "look" } });
  const aliases = Object.fromEntries((result.targets ?? []).map((target, index) => [`fixture-${index + 1}`, target.ref]));
  run.aliases = aliases;
  return { ...result, aliases: Object.keys(aliases).map((alias) => ({ alias, ref: aliases[alias] })) };
}
function inspect(runValue, alias) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  const target = run.aliases?.[alias] ?? alias;
  const result = inspectSessionObserver({ session: run.session, observer, request: { id: `inspect-${run.session.id}-${alias ?? ""}`, kind: "inspect", target } });
  if (result.outcome === "succeeded" && run.profile_id === FIELD_PROFILE) run.checklist.inspected = true;
  return result;
}
function status(runValue) {
  const run = normalizeRun(runValue);
  const observer = run.session.startup.player.observer_id;
  const view = look(run);
  const actions = getAvailableSessionActions({ session: run.session, actor: observer }).actions;
  const active = run.lifecycle !== "completed";
  return { profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, lifecycle: run.lifecycle, player: observer, known_resources: (run.session.startup.resources ?? []).filter((entry) => entry.custodian === observer).map((entry) => entry.id), available_verbs: ["LOOK", ...(view.targets?.length ? ["INSPECT"] : []), ...(active && actions.includes("traverse-controlled-route") ? ["MOVE"] : []), ...(active && actions.includes("toggle-light") ? ["USE"] : [])], view: { outcome: view.outcome, location: view.view?.location ?? null, targets: (view.aliases ?? []).map(({ alias }) => ({ alias })), public_reason: view.public_reason ?? null } };
}
function completeIfReady(run) { if (run.profile_id === FIELD_PROFILE && run.checklist.moved && run.checklist.inspected && run.checklist.used) run.lifecycle = "completed"; }
function act(runValue, verb, target) {
  const run = normalizeRun(runValue);
  if (verb === "LOOK") return { ok: true, outcome: "succeeded", result: look(run), run };
  if (verb === "INSPECT") { const result = inspect(run, target); return { ok: true, outcome: result.outcome === "succeeded" ? "succeeded" : "rejected", result, run }; }
  if (run.lifecycle === "completed") return { ok: false, error: { code: "RUN_COMPLETE" }, run };
  const action = { MOVE: "traverse-controlled-route", USE: "toggle-light" }[verb];
  if (!action) return { ok: false, error: { code: "UNSUPPORTED_VERB" }, run };
  const result = submitSessionAction({ session: run.session, actor: run.session.startup.player.observer_id, action, target });
  if (result.session) run.session = result.session;
  if (result.ok && result.outcome === "succeeded") { if (verb === "MOVE") run.checklist.moved = true; if (verb === "USE") run.checklist.used = true; completeIfReady(run); }
  return { ...result, run };
}
function saveRun(runValue) { const run = normalizeRun(runValue); return { version: "yellow-beast-save@v1", profile_id: run.profile_id, profile_title: run.profile_title, scenario: run.scenario, seed: run.seed, lifecycle: run.lifecycle, checklist: clone(run.checklist), aliases: clone(run.aliases), envelope: exportSession(run.session).envelope }; }
function resumeRun(save) { const restored = restoreSession(save.envelope); if (!restored.ok) return restored; return { ok: true, run: { version: "yellow-beast-run@v1", profile_id: save.profile_id, profile_title: profileFor(save.profile_id).title, scenario: save.scenario, seed: save.seed, session: restored.session, lifecycle: save.lifecycle, checklist: clone(save.checklist ?? {}), aliases: clone(save.aliases ?? {}) } }; }

if (require.main === module) { const args = process.argv.slice(2); const value = (name) => args[args.indexOf(name) + 1]; const result = startRun({ profile: value("--profile") || "lost", seed: value("--seed") || "yellow-beast-bootstrap" }); console.log(JSON.stringify(result.ok ? result.summary : result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
module.exports = { startRun, status, look, inspect, act, saveRun, resumeRun };
