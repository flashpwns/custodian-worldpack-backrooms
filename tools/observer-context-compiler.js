"use strict";

const canonicalLedger = require("./canonical-world-ledger");
const perceptionService = require("./perception-service");
const affordanceService = require("./affordance-service");
const canonLexicon = require("./canon-lexicon");
const observationAuthority = require("./observation-authority");

const VERSION = "yellow-beast-observer-context-compiler@v1";

function formatTime(interval = 0) {
  const totalSeconds = interval * 60; // 1 interval = 1 minute
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function compileObserverContext(run, observerId = null, currentInput = "", options = {}) {
  const playerId = run.session?.startup?.player?.observer_id ?? "player";
  const obs = observerId ?? playerId;
  const perceived = perceptionService.perceive(run, obs);

  // perceptionService.perceive() reads raw canonical state (any landmark,
  // object, connection, or teammate at the observer's location) without
  // regard for whether this observer has actually noticed it yet.
  // observation-authority is the sole authority on that, so every entry is
  // cross-checked against its projection before it can reach the model --
  // this can only narrow what perceive() found, never widen it.
  const observedFeatures = new Map(observationAuthority.projectFor(run, obs, run._world ?? null).map((item) => [item.featureId, item]));
  const isObserverSafe = (item) => {
    if (Object.hasOwn(item, "role")) return observedFeatures.has(`personnel:${item.id}`);
    return observedFeatures.has(`landmark:${item.id}`) || observedFeatures.has(`object:${item.id}`) || observedFeatures.has(`connection:${item.id}`);
  };
  const visiblePerceived = perceived.visible.filter(isObserverSafe);

  // Perception formatting
  const visibleList = [];
  for (const v of visiblePerceived) {
    const dist = v.distance_m ? `${v.distance_m}m` : "";
    const dir = v.direction ? v.direction : "";
    visibleList.push(`${v.name} ${dist} ${dir}`.replace(/\s+/g, " ").trim());
  }

  const audibleList = perceived.audible.map((a) => a.source);

  // Team status
  const team = {};
  for (const member of run.expedition?.team?.members ?? []) {
    const id = member.personnel_id ?? member.id;
    if (id === obs) continue;
    const nameKey = (member.first_name ?? member.display_name ?? id).toLowerCase();
    const isPresent = perceptionService.sameRoom(obs, id, run);
    const held = canonicalLedger.getEquipmentHeldBy(run, id).map((e) => e.label ?? e.id);
    const task = canonicalLedger.getCoworkerTask(run, id);
    const emotionalState = canonicalLedger.getCoworkerEmotionalState(run, id);
    const emotionalSummary = canonicalLedger.formatCoworkerEmotionalSummary(emotionalState);

    team[nameKey] = {
      id,
      present: isPresent,
      holding: held,
      task: task ? `${task.task} ${task.target ?? ""}`.trim() : null,
      state: emotionalSummary
    };
  }

  // Recent causal events (last 3 relevant events)
  const recentEvents = [];
  const ledger = run.causal_ledger ?? [];
  for (const entry of ledger.slice(-4)) {
    if (entry.kind === "location_entered") {
      recentEvents.push(`${entry.actor} entered ${entry.target}`);
    } else if (entry.kind === "task_assigned") {
      recentEvents.push(`${entry.actor} assigned to ${entry.details?.task} ${entry.target ?? ""}`.trim());
    } else if (entry.kind === "equipment_transfer") {
      recentEvents.push(`${entry.details?.item} given to ${entry.target}`);
    } else if (entry.kind === "observation_made") {
      recentEvents.push(`${entry.actor} observed ${entry.target}`);
    }
  }

  // Available referents
  const availableReferents = {
    person: Object.values(team).filter((t) => t.present).map((t) => t.id),
    object: visiblePerceived.filter((v) => !v.role && !v.name.includes("passage")).map((v) => v.name)
  };

  // Possible actions
  const possibleActions = new Set(["inspect", "speak"]);
  if (visiblePerceived.some((v) => v.name.includes("passage"))) possibleActions.add("move");
  const heldItems = canonicalLedger.getEquipmentHeldBy(run, obs);
  if (heldItems.length > 0) {
    possibleActions.add("give");
    if (heldItems.some((i) => i.capability?.includes("photo") || /camera/i.test(i.id))) possibleActions.add("photograph");
    if (heldItems.some((i) => i.capability?.includes("measurement") || /instrument/i.test(i.id))) possibleActions.add("test");
  }
  if (Object.values(team).some((t) => t.present)) {
    possibleActions.add("order_follow");
    possibleActions.add("order_hold");
    possibleActions.add("assign_task");
  }

  // Conversational memory
  const recentMessages = (run.expedition?.messages ?? [])
    .filter((m) => m.state === "delivered")
    .slice(-2)
    .map((m) => `${m.sender.toUpperCase()}: "${m.text}"`);

  const locDesc = canonLexicon.getLocationDescriptor(perceived.location_id);

  const packet = {
    version: VERSION,
    observer: obs === playerId ? "player" : obs,
    location: perceived.location_id,
    location_name: locDesc?.display_name ?? perceived.location_id,
    institutional_context: locDesc?.institutional_context ?? null,
    destination: locDesc?.known_destination ?? null,
    time: formatTime(run.expedition?.clock?.interval ?? 0),
    perception: {
      visible: visibleList,
      audible: audibleList
    },
    team,
    recent_events: recentEvents.slice(-3),
    conversational_memory: recentMessages,
    available_referents: availableReferents,
    possible_actions: Array.from(possibleActions)
  };

  return Object.freeze(packet);
}


// ═══════════════════════════════════════════════════════════════════════════
// LIVE DIALOGUE CONTEXT BRIDGE
//
//   canonical state -> observer/knowledge authorities -> OBSERVER-SAFE CAPSULE
//
// compileObserverDialogueContext is the ONE place that decides what a speaking
// character may know when a line is worded. It is pure, deterministic and
// rebuilt from CURRENT canonical state for every generation: it owns no memory,
// persists nothing and calls no model. Every admitted fact must pass
//
//   capsule_fact = canonical_fact AND observer_can_know_it AND contextually_relevant
//
// and carries INTERNAL provenance (never model-facing) naming the authority path
// that made it safe. Anything without a provenance path is not enumerated at all:
// unknown-to-the-speaker means ABSENT from the capsule, not "hidden by a prompt".
// Model-facing renderers may only reformat what this returns; they never query
// canonical state.
// ═══════════════════════════════════════════════════════════════════════════
const crypto = require("node:crypto");
const dialogueDiscourse = require("./dialogue-discourse");
const { contentWords, sameStem, coverage } = require("./dialogue-validation");
const { interpretUtterance, detectTopic } = require("./dialogue-interpretation");

const CAPSULE_VERSION = "yellow-beast-observer-dialogue-capsule@v1";
const AUTHORITY = Object.freeze({
  CURRENT_PERCEPTION: "current_perception",
  REMEMBERED_OBSERVATION: "remembered_observation",
  HEARD_COMMUNICATION: "heard_communication",
  SHARED_KNOWLEDGE: "shared_knowledge",
  SELF_KNOWLEDGE: "self_knowledge",
  INSTITUTIONAL_KNOWLEDGE: "institutional_knowledge"
});
const EPISTEMIC = Object.freeze({ PERCEIVED_NOW: "perceived_now", OBSERVED_EARLIER: "observed_earlier", TOLD: "told", RECORDED: "recorded", SELF: "self" });
const PHASE_LABELS = Object.freeze({ BRIEFING: "briefing", STAGING: "equipment staging", STANDARD_RADIO_CHECK: "radio check", THRESHOLD: "approach to the threshold", FIELD_OPERATION: "field operation", RETURN: "return" });
// Functions that carry world knowledge into the wording; social/repair/heard turns do not.
const INFORMATIONAL_FUNCTIONS = new Set(["ask_factual", "ask_personal_experience", "challenge", "make_request", "make_statement", "ask_item_ownership", "express_uncertainty"]);
const HISTORY_TAIL = Object.freeze({ repair: 2 });
const REPAIR_LIKE = new Set(["clarify_previous", "request_repetition", "ask_heard_confirmation"]);
const CUSTODY_CHANGING_EVENTS = new Set(["handed-over", "hand-over", "receive", "assign", "retrieve", "carry", "store", "place", "drop", "dropped", "recovered", "state-lost"]);
const MAX_HEARD_TURNS = 6;
const LINE_CAP = 180;

const normalizeId = (id) => String(id ?? "").replace(/^personnel-/, "");
const sameId = (a, b) => Boolean(a) && Boolean(b) && normalizeId(a) === normalizeId(b);
const clip = (text, n = LINE_CAP) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const firstName = (member) => member?.first_name ?? member?.display_name ?? null;
const memberIdOf = (member) => member?.personnel_id ?? member?.id ?? null;
const digestOf = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const humanize = (raw) => dialogueDiscourse.safePhrase(String(raw ?? "").replace(/^[a-z]+:/i, "").replace(/[:_]/g, " "));

/** Canonical revision stamp: monotone counters of the append-only ledgers this compile read. */
function stateRevision(run) {
  return Object.freeze({
    interval: run?.expedition?.clock?.interval ?? 0,
    causal: run?.causal_ledger?.length ?? 0,
    dialogue: run?.expedition?.dialogue_history?.length ?? 0,
    interactions: run?.expedition?.interaction_history?.length ?? 0
  });
}

/**
 * Can THIS observer know who holds an item? The only paths are: it is theirs
 * (self), they saw/took part in the custody event (a recorded direct
 * observation), or the item is still exactly as institutionally issued (no
 * custody change has ever been recorded). Custody that changed anywhere else is
 * unknown to them until they observe or are told -- canonical change alone never
 * reaches them.
 */
function resolveCustodyKnowledge(run, observerId, equipmentId) {
  const item = run?.expedition?.equipment?.[equipmentId] ?? Object.values(run?.expedition?.equipment ?? {}).find((entry) => entry?.id === equipmentId) ?? null;
  if (!item) return { known: false, reason: "item_unknown" };
  const holder = item.holder ?? null;
  const now = run?.expedition?.clock?.interval ?? 0;
  if (holder && sameId(holder, observerId)) return { known: true, authority: AUTHORITY.SELF_KNOWLEDGE, holder_id: holder, form: "current", source_ref: `equipment.${equipmentId}.holder` };
  const member = canonicalLedger.getObserverMember(run, observerId);
  const observed = (member?.known_information ?? []).filter((entry) => entry.kind === "custody-observed" && (entry.equipment_id === equipmentId || entry.equipment_id === item.id));
  const last = observed[observed.length - 1] ?? null;
  if (last) {
    if (sameId(last.holder_id, holder)) return { known: true, authority: last.at === now ? AUTHORITY.CURRENT_PERCEPTION : AUTHORITY.REMEMBERED_OBSERVATION, holder_id: holder, form: last.at === now ? "current" : "observed_earlier", source_ref: `known_information.custody-observed@${last.at}` };
    // They last saw it with someone else; custody has since changed out of their sight.
    return { known: false, reason: "custody_changed_unobserved", remembered: { holder_id: last.holder_id, at: last.at } };
  }
  const history = item.history ?? [];
  const changed = history.some((entry) => CUSTODY_CHANGING_EVENTS.has(String(entry.event ?? "").toLowerCase()));
  if (!changed && member) return { known: true, authority: AUTHORITY.INSTITUTIONAL_KNOWLEDGE, holder_id: holder, form: "recorded", source_ref: `equipment.${equipmentId}.issuance` };
  return { known: false, reason: "observer_authority_missing" };
}

/** Canonical holder of an item, by equipment key or item id. */
const holderOf = (run, equipmentId) => run?.expedition?.equipment?.[equipmentId]?.holder ?? Object.values(run?.expedition?.equipment ?? {}).find((item) => item?.id === equipmentId)?.holder ?? null;

/** Speech a given observer actually HEARD: canonical dialogue_history rows, never a global transcript. */
function collectHeardTurns(run, speakerId, { excludeSubmission = null, now = 0, maxGap = dialogueDiscourse.MAX_INTERVAL_GAP } = {}) {
  const playerId = run?.session?.startup?.player?.observer_id ?? null;
  const rows = [];
  for (const event of run?.expedition?.dialogue_history ?? []) {
    if (!event || event.kind !== "speech" || String(event.channel ?? "").toLowerCase() !== "local") continue;
    if (!["delivered", "heard"].includes(event.delivery ?? "delivered")) continue;
    if (excludeSubmission && event.submission_id === excludeSubmission) continue;
    const isSelf = sameId(event.speaker_id, speakerId);
    const heard = isSelf || (event.listeners ?? []).some((id) => sameId(id, speakerId));
    if (!heard) continue;
    const interval = Number(event.interval);
    if (Number.isFinite(interval) && interval > 0 && now - interval > maxGap) continue;
    const text = clip(event.text, 400);
    if (!text) continue;
    rows.push({ speaker_id: event.speaker_id, is_player: sameId(event.speaker_id, playerId), is_self: isSelf, speaker_name: event.speaker_name ?? null, text, interval: Number.isFinite(interval) ? interval : null, event_id: event.id ?? null });
  }
  return rows;
}

function compileObserverDialogueContext({
  run,
  speakerId,
  listeners = [],
  recipientContext = {},
  semanticFrame = null,
  responsePlan = null,
  contribution = null,
  submissionId = null,
  pendingInteractionId = null,
  phaseId = null,
  purpose = "response",
  observation = null,
  utterance = null,
  now = null
} = {}) {
  const member = canonicalLedger.getObserverMember(run, speakerId);
  if (!run?.expedition || !member) throw new Error("DIALOGUE_CONTEXT_SPEAKER_UNKNOWN");
  const sid = memberIdOf(member);
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const interval = now ?? run.expedition.clock?.interval ?? 0;
  const equipment = run.expedition.equipment ?? {};
  const frame = semanticFrame ?? null;
  const fn = frame?.discourse_function ?? contribution?.discourse_function ?? null;
  const provenance = [];
  const omitted = [];
  const commitSensitive = [];
  const prov = (path, authority, source_ref, { commit = false, freshness = "current" } = {}) => provenance.push(Object.freeze({ path, authority, source_ref, freshness, commit_sensitivity: commit ? "commit_sensitive" : "snapshot_stable" }));

  const names = Object.fromEntries((run.expedition.team?.members ?? []).map((m) => [memberIdOf(m), firstName(m)]));
  const speakerName = firstName(member);
  const nameOf = (id) => (sameId(id, playerId) ? "PLAYER" : (names[id] ?? names[normalizeId(id)] ?? null));

  // ── ACTOR (self knowledge) ──────────────────────────────────────────────
  const assignment = dialogueDiscourse.presentAssignment({ task: member.current_task ?? member.assignment ?? null, primary_task: member.primary_task ?? null, names: { ...names, [playerId]: "you" }, equipment, player_id: playerId });
  const activity = typeof member.current_activity === "string" ? dialogueDiscourse.presentAssignment({ task: member.current_activity }) : null;
  const style = { ...(contribution?.style_hints ?? {}) };
  const actor = { name: speakerName, role: member.role ?? null, assignment: assignment ?? null, activity: activity ?? null, style };
  prov("actor.name", AUTHORITY.SELF_KNOWLEDGE, "team.member.name");
  if (actor.role) prov("actor.role", AUTHORITY.SELF_KNOWLEDGE, "team.member.role");
  if (assignment) { prov("actor.assignment", AUTHORITY.SELF_KNOWLEDGE, "team.member.task", { commit: true }); commitSensitive.push({ kind: "assignment", person_id: sid, value: assignment }); }

  // ── CURRENT SCENE + PRESENT PEOPLE (current perception, gated by observation-authority) ──
  const scene = { location_name: null, phase: null };
  const presentPeople = [];
  let live = null;
  try { live = require("./live-scene-projection").projectLiveScene(run, { observer_id: sid }); } catch { live = null; }
  if (!live?.ok) omitted.push({ path: "scene", reason: "live_scene_unavailable" });
  const location = canonicalLedger.getPersonnelLocation(run, sid);
  if (live?.ok && live.packet.location.known_name) { scene.location_name = live.packet.location.known_name; prov("scene.location_name", AUTHORITY.CURRENT_PERCEPTION, "live-scene.location", { commit: true }); }
  else if (location) {
    // Standing in a room is perceiving it: its public display name, nothing about its surroundings.
    const descriptor = canonLexicon.getLocationDescriptor(location);
    if (descriptor?.display_name) { scene.location_name = descriptor.display_name; prov("scene.location_name", AUTHORITY.CURRENT_PERCEPTION, "own-location.display_name", { commit: true }); }
    else omitted.push({ path: "scene.location_name", reason: "observer_authority_missing" });
  }
  if (location) commitSensitive.push({ kind: "location", person_id: sid, value: location });
  if (phaseId && PHASE_LABELS[phaseId]) {
    scene.phase = PHASE_LABELS[phaseId];
    prov("scene.phase", AUTHORITY.INSTITUTIONAL_KNOWLEDGE, "expedition.phase", { commit: true });
    commitSensitive.push({ kind: "phase", value: phaseId, label: scene.phase });
  }
  const seenIds = new Set();
  for (const person of live?.ok ? live.packet.visible_personnel : []) {
    if (person.is_observer || sameId(person.observer_id, sid)) continue;
    const isPlayer = sameId(person.observer_id, playerId);
    seenIds.add(normalizeId(person.observer_id));
    // Presence grants a recognizable identity only through the live-scene identity authority; never a role or private state.
    presentPeople.push({ name: isPlayer ? "PLAYER" : (nameOf(person.observer_id) ?? person.known_identity), is_player: isPlayer });
    prov(`present_people.${isPlayer ? "player" : "person"}`, AUTHORITY.CURRENT_PERCEPTION, "live-scene.visible_personnel", { commit: true });
    commitSensitive.push({ kind: "presence", person_id: person.observer_id, value: location });
  }
  if (purpose === "response" && playerId && !seenIds.has(normalizeId(playerId))) {
    // The person speaking to the speaker is present by having spoken to them.
    presentPeople.unshift({ name: "PLAYER", is_player: true });
    prov("present_people.player", AUTHORITY.HEARD_COMMUNICATION, "local-communication.speaker", { commit: true });
    commitSensitive.push({ kind: "presence", person_id: playerId, value: location });
  }

  // ── RECENT HEARD TURNS (only speech this speaker actually heard) ────────
  const heardAll = purpose === "autonomous_report" ? [] : collectHeardTurns(run, sid, { excludeSubmission: submissionId, now: interval });
  const isRepairLike = REPAIR_LIKE.has(fn);
  // A raw last-N window is never enough: rows must bear on this turn. Repair, heard-confirmation and
  // exchange-continuing/social turns keep the immediate tail so the speaker knows who said what;
  // factual/personal/ownership questions get only topic- or referent-relevant rows.
  const tailSize = ["ask_factual", "ask_personal_experience", "ask_item_ownership"].includes(fn) ? 0 : HISTORY_TAIL.repair;
  const topic = frame?.topic && frame.topic !== "unknown" ? frame.topic : null;
  const queryWords = contentWords([utterance, ...(frame?.referents ?? []).map((ref) => ref.label)].filter(Boolean).join(" "));
  const relevantText = (text) => (topic && detectTopic(text) === topic) || queryWords.some((q) => contentWords(text).some((w) => sameStem(q, w)));
  const picked = new Set(tailSize ? heardAll.slice(-tailSize) : []);
  for (const row of [...heardAll].reverse()) { if (picked.size >= MAX_HEARD_TURNS) break; if (!picked.has(row) && relevantText(row.text)) picked.add(row); }
  const heardTurns = heardAll.filter((row) => picked.has(row)).map((row) => ({ speaker: row.is_player ? "PLAYER" : (row.speaker_name ?? nameOf(row.speaker_id) ?? "Someone"), is_self: row.is_self, is_player: row.is_player, text: row.text }));
  for (const row of heardAll.filter((r) => picked.has(r))) prov("heard_turns", AUTHORITY.HEARD_COMMUNICATION, `dialogue_history.${row.event_id ?? "event"}`);

  // Immediate repair / referent target: the exact line, even when outside the normal tail.
  let repairTarget = null;
  if (isRepairLike && frame?.antecedent?.resolved) {
    if (fn === "ask_heard_confirmation") {
      const row = [...heardAll].reverse().find((r) => r.is_player);
      if (row) repairTarget = { kind: "player_line_asked_about", speaker: "PLAYER", text: row.text };
    } else {
      const own = [...heardAll].reverse().find((r) => r.is_self);
      const other = [...heardAll].reverse().find((r) => !r.is_player);
      const row = own ?? other;
      if (row) repairTarget = { kind: "line_being_repaired", speaker: row.is_self ? speakerName : (row.speaker_name ?? "Someone"), is_self: row.is_self, text: row.text };
    }
    if (repairTarget) prov("conversation.repair_target", AUTHORITY.HEARD_COMMUNICATION, "dialogue_history.repair_antecedent");
    else omitted.push({ path: "conversation.repair_target", reason: "observer_authority_missing" });
  }

  // ── CONVERSATION STATE (deterministic structure derived from what was heard) ──
  const lastPlayerRow = [...heardAll].reverse().find((r) => r.is_player) ?? null;
  const lastRow = heardAll[heardAll.length - 1] ?? null;
  const recipientType = recipientContext.recipient_type ?? (frame?.target_scope === "direct" ? "direct" : frame?.target_scope === "group" ? "group" : "none");
  const conversation = {
    discourse_function: fn,
    current_topic: frame?.topic && frame.topic !== "unknown" ? frame.topic : null,
    previous_topic: lastPlayerRow ? (detectTopic(lastPlayerRow.text) !== "unknown" ? detectTopic(lastPlayerRow.text) : null) : null,
    recipient_scope: purpose === "autonomous_report" ? "room" : (recipientType === "direct" ? "you" : recipientType === "group" ? "group" : "room"),
    direct_target_name: recipientType === "direct" ? (recipientContext.target_id ? nameOf(recipientContext.target_id) : speakerName) : null,
    latest_speaker: lastRow ? (lastRow.is_player ? "PLAYER" : (lastRow.is_self ? speakerName : lastRow.speaker_name)) : null,
    introductions_occurred: heardAll.some((row) => row.is_player && (interpretUtterance(row.text).speech_act === "introduction" || /\bmy name is\b|\bcall me\b/i.test(row.text))),
    participants: [...new Set(heardAll.map((row) => (row.is_player ? "PLAYER" : (row.is_self ? speakerName : row.speaker_name))).filter(Boolean))],
    unresolved_repair: Boolean(frame?.unresolved_reference),
    heard_turn_count: heardTurns.length
  };
  if (purpose === "response") prov("conversation", AUTHORITY.HEARD_COMMUNICATION, "dialogue_history+semantic_frame");

  // ── RELEVANT KNOWN STATE (authority path AND relevance, else omitted) ────
  const knownState = [];
  const push = (item, path, authority, source_ref, opts) => { knownState.push(item); prov(path, authority, source_ref, opts); };
  const informational = INFORMATIONAL_FUNCTIONS.has(fn);
  if (purpose === "response" && informational) {
    const equipmentRefs = (frame?.referents ?? []).filter((ref) => ref.type === "equipment" && ref.resolved && ref.id);
    // The authorized contribution already states what it authorizes; context never restates it.
    const planStates = (key) => (contribution?.required_facts ?? []).some((f) => f.key === key);
    for (const ref of equipmentRefs) {
      const label = String(ref.label ?? ref.id).toLowerCase();
      if (planStates("item_holder")) { commitSensitive.push({ kind: "custody", equipment_id: ref.id, holder_id: holderOf(run, ref.id), label }); continue; }
      const custody = resolveCustodyKnowledge(run, sid, ref.id);
      if (custody.known) {
        const holderLabel = sameId(custody.holder_id, sid) ? "you" : nameOf(custody.holder_id);
        if (!holderLabel) { omitted.push({ path: `known_state.custody`, reason: "observer_authority_missing" }); continue; }
        const text = holderLabel === "you" ? `You are carrying the ${label}.` : `The ${label} is with ${holderLabel}.`;
        push({ kind: "custody", epistemic: custody.form === "observed_earlier" ? EPISTEMIC.OBSERVED_EARLIER : (holderLabel === "you" ? EPISTEMIC.SELF : (custody.authority === AUTHORITY.INSTITUTIONAL_KNOWLEDGE ? EPISTEMIC.RECORDED : EPISTEMIC.PERCEIVED_NOW)), text: custody.form === "observed_earlier" ? `You saw the ${label} with ${holderLabel === "you" ? "yourself" : holderLabel} earlier.` : text }, "known_state.custody", custody.authority, custody.source_ref, { commit: true });
        commitSensitive.push({ kind: "custody", equipment_id: ref.id, holder_id: custody.holder_id, label });
      } else if (custody.remembered) {
        const was = nameOf(custody.remembered.holder_id);
        if (was) { push({ kind: "custody", epistemic: EPISTEMIC.OBSERVED_EARLIER, text: `You last saw the ${label} with ${was}. You do not know where it is now.` }, "known_state.custody", AUTHORITY.REMEMBERED_OBSERVATION, custody.reason, { freshness: "stale_possible" }); }
        else omitted.push({ path: "known_state.custody", reason: "observer_authority_missing" });
      } else omitted.push({ path: "known_state.custody", reason: "observer_authority_missing" });
    }
    // Own held equipment (self knowledge) when the topic is equipment.
    if (frame?.topic === "equipment" && !planStates("held_equipment") && !planStates("item_holder") && equipmentRefs.length === 0) {
      const held = canonicalLedger.getEquipmentHeldBy(run, sid).map((item) => item.label ?? item.id).filter(Boolean);
      if (held.length) { push({ kind: "own_equipment", epistemic: EPISTEMIC.SELF, text: `You are carrying ${held.map((h) => `the ${String(h).toLowerCase()}`).join(" and ")}.` }, "known_state.own_equipment", AUTHORITY.SELF_KNOWLEDGE, "equipment.holder", { commit: true }); for (const item of canonicalLedger.getEquipmentHeldBy(run, sid)) commitSensitive.push({ kind: "custody", equipment_id: item.id, holder_id: sid, label: String(item.label ?? item.id).toLowerCase() }); }
    }
    // Remembered direct observations (their own bucket only) that bear on the question.
    for (const entry of (member.known_information ?? []).filter((info) => info.source === "direct-observation" || ["coordinated-inspection", "location-investigated"].includes(info.kind)).slice(-6)) {
      const subject = entry.kind === "location-investigated" ? humanize(entry.location) : humanize(entry.target);
      if (!subject || !relevantText(subject)) continue;
      push({ kind: "observation", epistemic: EPISTEMIC.OBSERVED_EARLIER, text: entry.kind === "location-investigated" ? `You checked the ${subject} earlier.` : `You inspected ${subject} earlier.` }, "known_state.observation", AUTHORITY.REMEMBERED_OBSERVATION, `known_information.${entry.kind ?? "direct-observation"}@${entry.at ?? "?"}`, { freshness: "snapshot" });
    }
    // Things other people told them (never restated as the speaker's own observation).
    for (const entry of (member.known_information ?? []).filter((info) => info.kind === "reported-knowledge").slice(-6)) {
      const from = entry.sender ?? entry.source_observer_id ?? null;
      if (!from || sameId(from, playerId) || sameId(from, sid)) continue;
      const teller = nameOf(from);
      const said = clip(entry.text ?? entry.proposition, 140);
      if (!teller || !said || !relevantText(said)) continue;
      push({ kind: "reported", epistemic: EPISTEMIC.TOLD, text: `${teller} told you: "${said}"` }, "known_state.reported", AUTHORITY.SHARED_KNOWLEDGE, `known_information.reported-knowledge@${entry.at ?? "?"}`, { freshness: "snapshot" });
    }
    // Institutional records this speaker was explicitly granted (never inferred from role or proximity).
    for (const record of live?.ok ? (live.packet.observer_knowledge.known_records ?? []) : []) {
      const said = clip(record.record_text, 160);
      if (!said || !relevantText(said)) continue;
      push({ kind: "record", epistemic: EPISTEMIC.RECORDED, text: `Records show: ${said}` }, "known_state.record", AUTHORITY.INSTITUTIONAL_KNOWLEDGE, `mission.prior_history.${record.record_id ?? "record"}`, { freshness: "snapshot" });
    }
    // Things in view now that the question is about.
    for (const object of live?.ok ? live.packet.visible_objects : []) {
      if (!object.name || !relevantText(object.name)) continue;
      push({ kind: "visible_object", epistemic: EPISTEMIC.PERCEIVED_NOW, text: `You can see the ${String(object.name).toLowerCase()}${typeof object.visible_condition === "string" && object.visible_condition && object.visible_condition !== "normal" ? ` (${clip(object.visible_condition, 60)})` : ""}.` }, "known_state.visible_object", AUTHORITY.CURRENT_PERCEPTION, "live-scene.visible_objects", { commit: true });
    }
  }
  if (purpose === "autonomous_report" && observation?.feature_id) {
    const bucketEntry = run.observation_state?.observers?.[sid]?.features?.[observation.feature_id] ?? null;
    const entity = canonLexicon.resolveCanonicalEntity(observation.feature_id);
    const subject = entity ? entity.display_name.replace(/^the /i, "") : humanize(observation.feature_id);
    if (bucketEntry && subject) {
      const present = observationAuthority.projectFor(run, sid, run._world ?? null).find((entry) => entry.featureId === observation.feature_id)?.present ?? false;
      // A canonical entity keeps its canonical name and class; a fixed gate is seen, never "noticed as an object".
      const text = entity ? (present ? `You can see ${entity.display_name}.` : `You saw ${entity.display_name} earlier.`) : `You noticed the ${subject}.`;
      push({ kind: "observation", epistemic: present ? EPISTEMIC.PERCEIVED_NOW : EPISTEMIC.OBSERVED_EARLIER, text, ...(entity ? { entity: entityFacts(entity) } : {}) }, "known_state.observation", present ? AUTHORITY.CURRENT_PERCEPTION : AUTHORITY.REMEMBERED_OBSERVATION, `observation_state.${String(observation.feature_id).split(":")[0]}`, { commit: present });
    } else omitted.push({ path: "known_state.observation", reason: "observer_authority_missing" });
  }
  // What a mentioned canonical entity IS (ontology, not current state). Current-state facts about it
  // enter only through the authority paths above (perception, memory, heard/told, institutional record).
  const mentioned = new Map();
  for (const entity of canonLexicon.entitiesMentioned([utterance, ...(frame?.referents ?? []).map((ref) => ref.label)].filter(Boolean).join(" "))) mentioned.set(entity.id, entity);
  if (purpose === "autonomous_report" && observation?.feature_id) { const own = canonLexicon.resolveCanonicalEntity(observation.feature_id); if (own && knownState.some((item) => item.kind === "observation")) mentioned.set(own.id, own); }
  const definitions = [];
  for (const entity of mentioned.values()) {
    definitions.push({ kind: "definition", epistemic: EPISTEMIC.RECORDED, text: entity.definition, entity: entityFacts(entity) });
    prov("known_state.definition", AUTHORITY.INSTITUTIONAL_KNOWLEDGE, `canon-lexicon.entity.${entity.id}`);
  }
  const cappedKnown = [...definitions, ...knownState].slice(0, 5);

  // ── LIVE HUMAN CONTEXT (canonically supported only; never a model-created mood) ──
  // Affect: only dimensions the member's canonical emotional_state has moved away from its default.
  // Circumstances: bounded facts derived from the canonical interaction just heard.
  // Relationship: only a recorded, attributed attitude. Neutral conversation is valid and emits no affect.
  const human = { affect: [], circumstances: [], relationship: null, ordinary: false };
  if (purpose === "response") {
    const base = canonicalLedger.DEFAULT_EMOTIONAL_STATE;
    const state = member.emotional_state ?? null;
    const moved = (key) => state && typeof state[key] === "number" && Math.abs(state[key] - base[key]) >= 0.2;
    if (moved("stress") && state.stress > base.stress) human.affect.push("tense and under some stress");
    if (moved("urgency") && state.urgency > (base.urgency ?? 0.2)) human.affect.push("feeling pressed for time");
    if (moved("fatigue") && state.fatigue > base.fatigue) human.affect.push("tired");
    if (moved("trust_player") && state.trust_player < base.trust_player) human.affect.push("guarded with PLAYER");
    if (human.affect.length) prov("human_context.affect", AUTHORITY.SELF_KNOWLEDGE, "member.emotional_state");
    const lastPlayerText = lastPlayerRow?.text ?? null;
    if (fn === "joke_or_sarcasm") human.circumstances.push("PLAYER just made a joke.");
    if (fn === "introduce_self") human.circumstances.push("PLAYER just introduced themself.");
    if (["clarify_previous", "request_repetition", "ambiguous_reference"].includes(fn)) human.circumstances.push("PLAYER did not follow what was just said and is asking for it again or explained.");
    if (lastPlayerText && utterance && coverage(utterance, lastPlayerText) >= 0.8 && coverage(lastPlayerText, utterance) >= 0.8) human.circumstances.push("PLAYER has just repeated something they already said.");
    if (human.circumstances.length) prov("human_context.circumstances", AUTHORITY.HEARD_COMMUNICATION, "dialogue_history+semantic_frame");
    const attitude = run._world?.characters?.[sid]?.continuity?.attitudes?.[playerId] ?? null;
    if (attitude && (attitude.attributions ?? []).length > 0 && attitude.disposition) { human.relationship = `Your working relationship with PLAYER is ${attitude.disposition}.`; prov("human_context.relationship", AUTHORITY.SHARED_KNOWLEDGE, "continuity.attitudes"); }
    // Absence may be stated only when the compiler can establish it: no moved affect dimension.
    human.ordinary = !human.affect.length;
  }

  const modelFacing = {
    version: CAPSULE_VERSION,
    purpose,
    actor,
    scene,
    present_people: presentPeople,
    conversation,
    heard_turns: heardTurns,
    repair_target: repairTarget,
    current_utterance: utterance ? { speaker: "PLAYER", text: clip(utterance, 400) } : null,
    human_context: human,
    known_state: cappedKnown
  };
  const capsule = JSON.parse(JSON.stringify(modelFacing));
  const internal = {
    version: CAPSULE_VERSION,
    meta: {
      world_id: run._world?.world_id ?? null,
      run_id: run.run_id ?? null,
      speaker_id: sid,
      submission_id: submissionId ?? null,
      pending_interaction_id: pendingInteractionId ?? null,
      purpose,
      plan_id: responsePlan || contribution ? digestOf(responsePlan ?? contribution) : null,
      interval,
      revision: stateRevision(run)
    },
    provenance,
    omitted,
    commit_sensitive: commitSensitive,
    fingerprint: digestOf(modelFacing)
  };
  Object.defineProperty(capsule, "_internal", { configurable: true, enumerable: false, value: Object.freeze(internal) });
  return deepFreezeCapsule(capsule);
}

/** The ontology facts of a canonical entity that constrain what may be implied about it. */
const entityFacts = (entity) => ({ name: entity.display_name, entity_class: entity.entity_class, portable: entity.portable, inventory_capable: entity.inventory_capable, crossable: entity.crossable, connects: [...entity.connects] });

function deepFreezeCapsule(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeCapsule(child);
  return Object.freeze(value);
}

/** Current value of a commit-sensitive descriptor, from canonical authorities. */
function currentCommitValue(run, descriptor, { phaseId = null } = {}) {
  switch (descriptor.kind) {
    case "custody": return holderOf(run, descriptor.equipment_id);
    case "presence": return canonicalLedger.getPersonnelLocation(run, descriptor.person_id) ?? null;
    case "location": return canonicalLedger.getPersonnelLocation(run, descriptor.person_id) ?? null;
    case "phase": return phaseId ?? descriptor.value;
    case "assignment": {
      const member = canonicalLedger.getObserverMember(run, descriptor.person_id);
      const names = Object.fromEntries((run.expedition.team?.members ?? []).map((m) => [memberIdOf(m), firstName(m)]));
      const playerId = run.session?.startup?.player?.observer_id ?? null;
      return dialogueDiscourse.presentAssignment({ task: member?.current_task ?? member?.assignment ?? null, primary_task: member?.primary_task ?? null, names: { ...names, [playerId]: "you" }, equipment: run.expedition.equipment ?? {}, player_id: playerId }) ?? null;
    }
    default: return descriptor.value ?? null;
  }
}
const stampedValue = (descriptor) => (descriptor.kind === "custody" ? descriptor.holder_id ?? null : descriptor.value ?? null);
const sameStamp = (a, b) => (a == null && b == null) || (a != null && b != null && normalizeId(a) === normalizeId(b));

/** Does the wording assert something about this commit-sensitive subject? */
function speechAsserts(run, descriptor, speech) {
  const text = String(speech ?? "");
  switch (descriptor.kind) {
    case "custody": {
      const holderNames = [descriptor.holder_id, holderOf(run, descriptor.equipment_id)].map((id) => canonicalLedger.getObserverMember(run, id)).filter(Boolean).map(firstName).filter(Boolean);
      const head = contentWords(descriptor.label).slice(-1)[0];
      const namesItem = coverage(text, descriptor.label) >= 0.5 || (head && contentWords(text).some((w) => sameStem(w, head)));
      return Boolean(namesItem) || holderNames.some((name) => new RegExp(`\\b${name}\\b`, "i").test(text));
    }
    case "presence": { const name = firstName(canonicalLedger.getObserverMember(run, descriptor.person_id)); return Boolean(name) && new RegExp(`\\b${name}\\b`, "i").test(text); }
    case "location": return /\b(?:here|room|area|station|hall|corridor)\b/i.test(text);
    case "phase": return descriptor.label ? coverage(text, descriptor.label) >= 0.5 : false;
    case "assignment": return descriptor.value ? coverage(text, descriptor.value) >= 0.5 : false;
    default: return false;
  }
}

/**
 * Pre-commit check: the candidate must still belong to the same world / run /
 * speaker / conversational turn / response plan, and any commit-sensitive fact
 * the wording actually asserts must still hold in CURRENT canonical state.
 * Reads only canonical authorities and the capsule's internal stamp; never
 * mutates and never calls a model.
 */
function revalidateContext({ run, capsule, speech = "", speakerId = null, submissionId = null, plan = null, phaseId = null } = {}) {
  const internal = capsule?._internal;
  if (!internal) return { ok: false, code: "CONTEXT_CAPSULE_MISSING", stale: [] };
  const meta = internal.meta;
  if ((run._world?.world_id ?? null) !== meta.world_id) return { ok: false, code: "CONTEXT_WORLD_MISMATCH", stale: [] };
  if ((run.run_id ?? null) !== meta.run_id) return { ok: false, code: "CONTEXT_RUN_MISMATCH", stale: [] };
  if (speakerId && !sameId(speakerId, meta.speaker_id)) return { ok: false, code: "CONTEXT_SPEAKER_MISMATCH", stale: [] };
  if (submissionId !== null && meta.submission_id !== null && submissionId !== meta.submission_id) return { ok: false, code: "CONTEXT_TURN_MISMATCH", stale: [] };
  if (plan && meta.plan_id && digestOf(plan) !== meta.plan_id) return { ok: false, code: "CONTEXT_PLAN_MISMATCH", stale: [] };
  // Whole-turn validity (not just factual staleness): a reply belongs to a speaker who is still an
  // active participant and still within speaking range of the person who spoke.
  if (internal.meta.purpose === "response") {
    const member = canonicalLedger.getObserverMember(run, meta.speaker_id);
    const playerLoc = run.spatial?.player_location ?? null;
    const speakerLoc = canonicalLedger.getPersonnelLocation(run, meta.speaker_id);
    if (!member || (member.status && member.status !== "active") || (playerLoc && speakerLoc && playerLoc !== speakerLoc)) return { ok: false, code: "CONTEXT_TURN_CANCELLED", cancel: true, stale: [] };
  }
  const stale = [];
  for (const descriptor of internal.commit_sensitive) {
    const current = currentCommitValue(run, descriptor, { phaseId });
    if (sameStamp(current, stampedValue(descriptor))) continue;
    if (speechAsserts(run, descriptor, speech)) stale.push({ kind: descriptor.kind, subject: descriptor.label ?? descriptor.kind });
  }
  return stale.length ? { ok: false, code: "CONTEXT_COMMIT_SENSITIVE_STALE", stale } : { ok: true, stale: [] };
}

/** Dev-only description of a capsule: names, counts and provenance categories -- never hidden values. */
function describeCapsule(capsule) {
  const internal = capsule?._internal;
  if (!internal) return null;
  const authorities = {};
  for (const item of internal.provenance) authorities[item.authority] = (authorities[item.authority] ?? 0) + 1;
  return {
    speaker: capsule.actor?.name ?? null,
    scene_fields: Object.entries(capsule.scene ?? {}).filter(([, v]) => v != null).map(([k]) => k),
    present_people: capsule.present_people.map((p) => p.name),
    current_topic: capsule.conversation?.current_topic ?? null,
    discourse_function: capsule.conversation?.discourse_function ?? null,
    repair_antecedent: Boolean(capsule.repair_target),
    heard_turns: capsule.heard_turns.length,
    known_state_keys: capsule.known_state.map((item) => item.kind),
    provenance: authorities,
    omitted: internal.omitted.map((item) => `${item.path}: ${item.reason.replace(/_/g, " ")}`),
    meta: internal.meta,
    fingerprint: internal.fingerprint
  };
}

module.exports = {
  VERSION,
  CAPSULE_VERSION,
  AUTHORITY,
  EPISTEMIC,
  compileObserverContext,
  compileObserverDialogueContext,
  resolveCustodyKnowledge,
  collectHeardTurns,
  revalidateContext,
  describeCapsule,
  stateRevision
};
