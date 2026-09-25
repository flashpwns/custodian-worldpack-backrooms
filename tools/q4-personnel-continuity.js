"use strict";

// Canonical continuity and reaction authority.  This intentionally records
// small operational facts rather than biographies or relationship scores.
const crypto = require("node:crypto");
const history = require("./world-history");
const spatialRuntime = require("./spatial-runtime");

const VERSION = "yellow-beast-q4-personnel-continuity@v1";
const MAX_HISTORY = 80;
const FIELD_PHASES = new Set(["FIELD_OPERATION", "RETURN"]);
const VALID_PHASES = new Set(["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN", "DEBRIEF"]);
const clone = (value) => structuredClone(value);
const score = (parts) => Number.parseInt(crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 8), 16);
const bounded = (value) => Math.max(0, Math.min(100, Math.round(value)));

function tendencies(identity) {
  return {
    procedural_caution: 28 + (score([identity, "procedural-caution"]) % 53),
    communication_frequency: 18 + (score([identity, "communication-frequency"]) % 58),
    confirmation_preference: 24 + (score([identity, "confirmation-preference"]) % 57),
    separation_tolerance: 24 + (score([identity, "separation-tolerance"]) % 55),
    equipment_accountability: 32 + (score([identity, "equipment-accountability"]) % 50)
  };
}

function samePersonnel(id1, id2) {
  if (!id1 || !id2) return false;
  if (id1 === id2) return true;
  const s1 = String(id1).toLowerCase().replace(/^personnel-/, "");
  const s2 = String(id2).toLowerCase().replace(/^personnel-/, "");
  if (s1 === s2) return true;
  if ((s1 === "you" || s1 === "player") && (s2 === "you" || s2 === "player")) return true;
  return false;
}

function heardInitiatingUtterance(entry, observerId) {
  if (!entry || !observerId) return false;
  if (!entry.player_text) return false;
  if (samePersonnel(entry.speaker_id, observerId)) return true;
  if (entry.speaker && samePersonnel(entry.speaker, observerId)) return true;
  if (Array.isArray(entry.listeners)) {
    return entry.listeners.some((id) => samePersonnel(id, observerId));
  }
  if (Array.isArray(entry.recipient_ids)) {
    return entry.recipient_ids.some((id) => samePersonnel(id, observerId));
  }
  const targets = entry.targets ?? [];
  return targets.some((t) => samePersonnel(t, observerId));
}

function heardResponseUtterance(entry, observerId) {
  if (!entry || !observerId) return false;
  const hasResponse = Boolean(entry.presentation?.response ?? entry.response);
  if (!hasResponse) return false;
  if (samePersonnel(entry.response_speaker_id, observerId)) return true;
  if (entry.response_speaker && samePersonnel(entry.response_speaker, observerId)) return true;
  if (Array.isArray(entry.response_listeners)) {
    return entry.response_listeners.some((id) => samePersonnel(id, observerId));
  }
  if (samePersonnel(entry.speaker_id, observerId)) return true;
  if (entry.speaker && samePersonnel(entry.speaker, observerId)) return true;
  return false;
}

function isParticipantOrListener(entry, speakerId) {
  return heardInitiatingUtterance(entry, speakerId) || heardResponseUtterance(entry, speakerId);
}

function defaultAttitude(identity, targetId, tendencies, sharedHistory = []) {
  const sharedOps = (sharedHistory ?? []).filter((h) => (h.participants ?? []).some((p) => samePersonnel(p, targetId)) && h.kind === "served-together").length;
  const baseTrust = bounded(50 + (tendencies?.confirmation_preference > 50 ? 5 : 0) + sharedOps * 5);
  const baseRapport = bounded(50 + sharedOps * 5);
  return {
    trust: baseTrust,
    rapport: baseRapport,
    disposition: baseTrust >= 65 ? "supportive" : baseTrust >= 50 ? "cooperative" : "neutral",
    sentiment: sharedOps > 0 ? "Familiar working partner with prior field history." : "Standard working relationship.",
    attributions: []
  };
}

function getAttitude(person, targetId) {
  if (!person) return null;
  const continuity = person.continuity ?? (person.continuity = { version: VERSION });
  continuity.attitudes ??= {};
  continuity.relationships ??= continuity.attitudes;
  const key = String(targetId ?? "player");
  if (!continuity.attitudes[key]) {
    continuity.attitudes[key] = defaultAttitude(
      person.identity,
      key,
      continuity.tendencies ?? tendencies(person.identity),
      continuity.shared_history ?? []
    );
    continuity.relationships[key] = continuity.attitudes[key];
  }
  return continuity.attitudes[key];
}

function recordAttitudeChange(world, { run_id, identity, target_id, delta = {}, reason = "", at = null }) {
  const person = ensurePerson(world, run_id, identity);
  if (!person) return null;
  const current = getAttitude(person, target_id);
  const nextTrust = bounded(current.trust + (delta.trust ?? 0));
  const nextRapport = bounded(current.rapport + (delta.rapport ?? 0));

  let disposition = "neutral";
  if ((nextTrust >= 60 && nextRapport >= 55) || nextTrust >= 65) disposition = "supportive";
  else if (nextTrust >= 50) disposition = "cooperative";
  else if (nextTrust <= 25) disposition = "guarded";
  else if (nextTrust <= 35) disposition = "skeptical";

  let sentiment = current.sentiment;
  if (reason) {
    sentiment = `${disposition.charAt(0).toUpperCase() + disposition.slice(1)}: ${reason}`;
  }

  const attribution = {
    at,
    run_id,
    delta: clone(delta),
    reason
  };

  const updatedAttitude = {
    trust: nextTrust,
    rapport: nextRapport,
    disposition,
    sentiment,
    attributions: [...(current.attributions ?? []), attribution].slice(-20)
  };

  const key = String(target_id ?? "player");
  person.continuity.attitudes[key] = updatedAttitude;
  person.continuity.relationships[key] = updatedAttitude;

  const eventPayload = {
    identity,
    target_id: key,
    delta: clone(delta),
    reason,
    at,
    run_id,
    resulting_attitude: clone(updatedAttitude)
  };
  history.event(world, run_id, "character.attitude.changed", eventPayload, "q4-personnel-continuity");
  return updatedAttitude;
}

function retrieveRelevantMemories(person, expedition, { queryText = "", speakerId, playerId, limit = 5, excludeRecent = [] } = {}) {
  const seenKeys = new Set();
  for (const item of excludeRecent) {
    if (item.id) seenKeys.add(item.id);
    if (item.player_text) {
      seenKeys.add(`${item.player_text}:${item.response}`);
      seenKeys.add(`${item.player_text}:null`);
    }
  }

  const memories = [];
  const characterMemories = person?.continuity?.dialogue_memories ?? [];
  for (const m of characterMemories) {
    if (m.identity && !samePersonnel(m.identity, speakerId)) continue;
    memories.push({
      id: m.id,
      player_text: m.player_text ?? null,
      response: m.response ?? null,
      speaker: person?.first_name ?? person?.display_name ?? null,
      sender: m.sender ?? null,
      at: m.at ?? null,
      source: "character-dialogue-memory"
    });
  }

  const interactions = expedition?.interaction_history ?? [];
  for (const entry of interactions) {
    if (entry.channel !== "local") continue;
    const heardInit = heardInitiatingUtterance(entry, speakerId);
    const heardResp = heardResponseUtterance(entry, speakerId);
    if (!heardInit && !heardResp) continue;

    const projectedPlayerText = heardInit ? (entry.player_text ?? null) : null;
    const projectedResponse = heardResp ? (entry.presentation?.response ?? entry.response ?? null) : null;
    const projectedSpeaker = heardResp ? (entry.response_speaker ?? null) : null;
    const projectedSender = heardInit ? (entry.speaker_id ?? entry.speaker ?? "You") : null;

    if (!memories.some((m) => m.id === entry.id || (m.player_text === projectedPlayerText && m.response === projectedResponse))) {
      memories.push({
        id: entry.id,
        player_text: projectedPlayerText,
        response: projectedResponse,
        speaker: projectedSpeaker,
        sender: projectedSender,
        at: entry.at ?? null,
        source: "expedition-interaction"
      });
    }
  }

  const query = String(queryText ?? "").toLowerCase().trim();
  if (!query) return memories.slice(-limit);

  const STOP_WORDS = new Set(["what", "which", "where", "when", "who", "whom", "this", "that", "there", "then", "here", "with", "from", "have", "been", "were", "your", "mine", "about", "could", "would", "should", "tell", "told", "asked", "said"]);
  const queryTokens = query.split(/[^a-z0-9_-]+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  const isExplicitReplyQuery = /\b(?:what was your (?:reply|response)|what did you (?:say|reply|answer)|recall your reply)\b/i.test(query);

  const scored = [];
  for (const memory of memories) {
    const isExcluded = (memory.id && seenKeys.has(memory.id)) ||
      (memory.player_text && (seenKeys.has(`${memory.player_text}:${memory.response}`) || seenKeys.has(`${memory.player_text}:null`)));
    if (isExcluded) continue;

    let score = 0;
    const pText = String(memory.player_text ?? "").toLowerCase().trim();
    const rText = String(memory.response ?? "").toLowerCase().trim();

    // The current query itself cannot be a prior memory to recall
    if (pText === query) continue;

    for (const token of queryTokens) {
      if (memory.player_text && pText.includes(token)) score += 10;
      if (memory.response && rText.includes(token)) score += isExplicitReplyQuery ? 20 : 8;
    }

    const phraseMatches = query.match(/(?:turn\s+\d+|tight spaces|nervous|call me|casey|route notes|survey instrument|recording device|first|earlier)/gi) ?? [];
    for (const phrase of phraseMatches) {
      const pl = phrase.toLowerCase();
      if (memory.player_text && pText.includes(pl)) score += 30;
      if (memory.response && rText.includes(pl)) score += 35;
    }

    if (score > 0) {
      scored.push({ ...memory, relevance_score: score });
    }
  }

  scored.sort((a, b) => b.relevance_score - a.relevance_score);
  return scored.slice(0, limit);
}

function qualifications(person) {
  const role = String(person?.role ?? "").toLowerCase();
  const result = new Set(["field-operation", "local-communication"]);
  if (/survey|route|research/.test(role)) result.add("survey");
  if (/documentation|record/.test(role)) result.add("documentation");
  if (/safety/.test(role)) result.add("field-safety");
  if (/route/.test(role)) result.add("route-assessment");
  return [...result].sort();
}

function ensurePerson(world, runId, identity) {
  const person = history.character(world, identity);
  if (!person) return null;
  if (!person.continuity || person.continuity.version !== VERSION) {
    person.continuity = { version: VERSION, tendencies: tendencies(identity), qualifications: qualifications(person), shared_history: [], equipment_custody_history: [], reaction_history: [], dialogue_memories: [], attitudes: {}, relationships: {} };
    history.event(world, runId ?? "personnel-continuity-migration", "character.continuity.initialized", { identity, continuity: clone(person.continuity) }, "q4-personnel-continuity");
  } else {
    person.continuity.tendencies ??= tendencies(identity);
    person.continuity.qualifications ??= qualifications(person);
    person.continuity.shared_history ??= [];
    person.continuity.equipment_custody_history ??= [];
    person.continuity.reaction_history ??= [];
    person.continuity.dialogue_memories ??= [];
    person.continuity.attitudes ??= {};
    person.continuity.relationships ??= person.continuity.attitudes;
  }
  return person;
}

function recordDialogueMemory(world, { run_id, identity, player_text, response = null, source = "local-communication", sender = null, at = null }) {
  const person = ensurePerson(world, run_id, identity);
  if (!person) return null;
  person.continuity.dialogue_memories ??= [];
  const memoryId = `q4-memory-${crypto.createHash("sha256").update(JSON.stringify([world.world_id, run_id, identity, player_text, person.continuity.dialogue_memories.length])).digest("hex").slice(0, 18)}`;
  const memory = {
    id: memoryId,
    identity,
    player_text,
    response,
    source,
    sender,
    at
  };
  limited(person.continuity.dialogue_memories, memory);
  history.event(world, run_id, "character.dialogue-memory.recorded", memory, "q4-personnel-continuity");
  return memory;
}

function ensureTeam(world, runId, members = []) { return members.map((member) => ensurePerson(world, runId, member.personnel_id ?? member.id ?? member.identity)).filter(Boolean); }
function limited(list, item) { list.push(clone(item)); if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY); }

function historyId(world, runId, kind, participants, refs) { return `q4-shared-${crypto.createHash("sha256").update(JSON.stringify([world.world_id, runId, kind, [...participants].sort(), refs])).digest("hex").slice(0, 18)}`; }
function recordSharedHistory(world, { run_id, participants, kind, refs = {}, at = null }) {
  const identities = [...new Set((participants ?? []).filter(Boolean))].sort();
  if (identities.length < 2) return { ok: false, code: "SHARED_HISTORY_PARTICIPANTS_REQUIRED" };
  for (const identity of identities) if (!ensurePerson(world, run_id, identity)) return { ok: false, code: "PERSONNEL_UNKNOWN" };
  const id = historyId(world, run_id, kind, identities, refs);
  if (world.events.some((entry) => entry.type === "character.shared-history.recorded" && entry.payload?.id === id)) return { ok: true, idempotent: true, id };
  const fact = { id, run_id, kind, participants: identities, refs: clone(refs), at };
  for (const identity of identities) limited(history.character(world, identity).continuity.shared_history, fact);
  history.event(world, run_id, "character.shared-history.recorded", fact, "q4-personnel-continuity");
  return { ok: true, idempotent: false, id, fact: clone(fact) };
}

function recordCustody(world, { run_id, equipment_id, from, to, at = null }) {
  const participants = [from, to].filter(Boolean); if (!participants.length) return { ok: false, code: "CUSTODY_PARTICIPANTS_REQUIRED" };
  for (const identity of participants) if (!ensurePerson(world, run_id, identity)) return { ok: false, code: "PERSONNEL_UNKNOWN" };
  const id = `q4-custody-${crypto.createHash("sha256").update(JSON.stringify([world.world_id, run_id, equipment_id, from, to, at])).digest("hex").slice(0, 18)}`;
  if (world.events.some((entry) => entry.type === "character.equipment-custody.recorded" && entry.payload?.id === id)) return { ok: true, idempotent: true, id };
  const record = { id, run_id, equipment_id, from: from ?? null, to: to ?? null, at };
  for (const identity of participants) limited(history.character(world, identity).continuity.equipment_custody_history, record);
  history.event(world, run_id, "character.equipment-custody.recorded", record, "q4-personnel-continuity");
  return { ok: true, idempotent: false, id };
}

function memberFor(run, identity) { return (run?.expedition?.team?.members ?? []).find((member) => (member.personnel_id ?? member.id) === identity) ?? null; }
function knownEvent(workerId, event = {}) { return (event.observed_by ?? []).includes(workerId) || (event.delivered_to ?? []).includes(workerId) || event.actor === workerId; }
function roleRelevance(person, event) {
  const role = String(person?.role ?? "").toLowerCase(); const tags = event.role_tags ?? [];
  if (!tags.length) return 0;
  if (tags.includes("equipment") && /documentation|safety/.test(role)) return 18;
  if (tags.includes("route") && /survey|route/.test(role)) return 22;
  if (tags.includes("documentation") && /documentation/.test(role)) return 25;
  if (tags.includes("safety") && /safety/.test(role)) return 25;
  return 0;
}

// The returned object is deliberately a safe projection: no objective topology,
// unseen event payload, private UI state, or other observer's knowledge escapes.
function reactionContext({ world, run, phase, worker_id, player_id, event = {} }) {
  const worker = ensurePerson(world, run?.run_id, worker_id);
  const member = memberFor(run, worker_id); const playerMember = memberFor(run, player_id);
  if (!worker || !member || !VALID_PHASES.has(phase)) return { valid: false, code: "REACTION_CONTEXT_UNAVAILABLE", reaction: null };
  const workerLocation = run?.spatial?.personnel_locations?.[worker_id] ?? null;
  const playerLocation = run?.spatial?.personnel_locations?.[player_id] ?? null;
  const proximity = run?.spatial && player_id ? spatialRuntime.proximity(run.spatial, player_id, worker_id) : { category: "LOCAL", speaking_range: true };
  const delivered = (event.delivered_to ?? []).includes(worker_id);
  const direct = knownEvent(worker_id, event) && (!event.location || event.location === workerLocation || delivered);
  const fieldEvent = event.scene === "field" || Boolean(event.location);
  if (fieldEvent && !FIELD_PHASES.has(phase)) return { valid: false, code: "REACTION_WRONG_PHASE", reaction: null };
  if (!direct) return { valid: false, code: "REACTION_EVENT_UNKNOWN", reaction: null };
  const safeEvent = { id: String(event.id ?? "known-event"), category: String(event.category ?? "operational"), summary: String(event.summary ?? "known condition").slice(0, 240), novelty_key: String(event.novelty_key ?? event.id ?? "known-event"), operational_importance: bounded(event.operational_importance ?? 0), perceived_risk: bounded(event.perceived_risk ?? 0), role_tags: [...(event.role_tags ?? [])], direct_involvement: (event.participants ?? []).includes(worker_id), delivered, is_question: event.is_question ?? null };
  const relevantHistory = worker.continuity.shared_history.filter((fact) => event.history_keys?.some((key) => Object.values(fact.refs ?? {}).includes(key))).slice(-4).map((fact) => ({ id: fact.id, kind: fact.kind }));
  const workerAttitude = getAttitude(worker, player_id);
  return { version: "yellow-beast-personnel-reaction-context@v1", valid: true, operation: { run_id: run?.run_id ?? null, phase }, worker: { identity: worker.identity, role: worker.role, qualifications: clone(worker.continuity.qualifications), tendencies: clone(worker.continuity.tendencies), condition: worker.condition, task: clone(member.current_task ?? member.assignment ?? null), location: workerLocation, reaction_history: clone(worker.continuity.reaction_history), attitude: clone(workerAttitude) }, player: { contact: proximity.category, location: proximity.speaking_range ? playerLocation : null }, assignment: clone(worker.current_assignment ?? member.assignment ?? null), equipment: Object.values(run?.expedition?.equipment ?? {}).filter((item) => item.holder === worker_id).map((item) => ({ id: item.id, label: item.label, state: item.state })), event: safeEvent, relevant_history: relevantHistory, allowable_reactions: ["silence", "acknowledgment", "warning", "question", "uncertainty"] };
}

function salience(context) {
  if (!context?.valid) return { eligible: false, score: 0, reason: context?.code ?? "REACTION_CONTEXT_UNAVAILABLE", category: "silence" };
  const event = context.event; const tendency = context.worker.tendencies;
  const prior = (context.worker.reaction_history ?? []); // retained only for standalone callers; canonical lookup follows below.
  const base = event.operational_importance * .55 + event.perceived_risk * .35 + roleRelevance(context.worker, event) + (event.direct_involvement ? 16 : 0) + context.relevant_history.length * 5 + tendency.communication_frequency * .18;
  const repetitions = prior.filter((entry) => entry.novelty_key === event.novelty_key).length;
  const scoreValue = bounded(base - repetitions * 65);
  const trustBonus = ((context.worker?.attitude?.trust ?? 50) - 50) * 0.2;
  const threshold = 58 - tendency.communication_frequency * .12 - trustBonus;
  const category = event.perceived_risk >= 65 ? "warning" : event.is_question ? "question" : event.is_question === false ? (event.delivered ? "acknowledgment" : "uncertainty") : event.operational_importance >= 62 ? "question" : event.delivered ? "acknowledgment" : "uncertainty";
  return { eligible: scoreValue >= threshold, score: scoreValue, threshold: bounded(threshold), repetitions, category: scoreValue >= threshold ? category : "silence", reason: scoreValue >= threshold ? "SALIENCE_THRESHOLD_MET" : "SALIENCE_BELOW_THRESHOLD" };
}

function react(world, context) {
  const result = salience(context); if (!context?.valid || !result.eligible) return { ...result, reaction: null };
  const worker = ensurePerson(world, context.operation.run_id, context.worker.identity);
  const prior = worker.continuity.reaction_history.filter((entry) => entry.novelty_key === context.event.novelty_key).length;
  const reevaluated = { ...context, worker: { ...context.worker, reaction_history: worker.continuity.reaction_history } };
  const final = { ...salience(reevaluated), prior_reactions: prior };
  if (!final.eligible) return { ...final, reaction: null };
  const reaction = { id: `q4-reaction-${crypto.createHash("sha256").update(JSON.stringify([context.operation.run_id, worker.identity, context.event.id, final.category, prior])).digest("hex").slice(0, 18)}`, novelty_key: context.event.novelty_key, event_id: context.event.id, category: final.category, at: context.operation.run_id, basis: { role_relevance: roleRelevance(worker, context.event), relevant_history: context.relevant_history.map((item) => item.id), score: final.score } };
  limited(worker.continuity.reaction_history, reaction);
  history.event(world, context.operation.run_id, "character.reaction.recorded", { identity: worker.identity, reaction }, "q4-personnel-salience");
  return { ...final, reaction: clone(reaction) };
}

function presentReaction(person, reaction, playerText = "", targetId = null, speechAct = null) {
  if (!reaction) return null;
  const name = person?.first_name ?? person?.display_name ?? "Assigned teammate";
  const statement = String(playerText ?? "").trim().replace(/\s+/g, " ").slice(0, 96);
  const isDisclosure = /\b(?:nervous|afraid|scared|prefer|call me|tight spaces|dark|claustrophobic|worried)\b/i.test(statement);
  const isOperationalReport = /\b(?:route|relay|team|corridor|passage|equipment|radio|room|door|wall|floor|fixture|outpost|threshold)\b/i.test(statement);
  const attitude = targetId && person ? getAttitude(person, targetId) : null;
  const isSupportive = attitude?.disposition === "supportive" || (attitude?.trust ?? 50) >= 65;
  const isGuarded = attitude?.disposition === "guarded" || attitude?.disposition === "skeptical" || (attitude?.trust ?? 50) <= 35;

  const personality = person?.personality ?? person?.archetype ?? "";

  // Social / sarcasm / greeting acts — do not convert to FAQ fallback
  const isSocial = speechAct != null && ["social_observation", "joke_or_sarcasm", "greeting", "introduction", "acknowledgment"].includes(speechAct);
  const isPersonalQ = speechAct === "personal_question";
  const isFactualQ = speechAct === "factual_question" || speechAct === "group_question";

  if (isSocial) {
    // Social acknowledgment: restrained, in-character, no information content.
    // Fallback wording here must read as SOCIAL, never operational -- "ready
    // when you are" / "awaiting orders" style phrasing is reserved for actual
    // readiness/task exchanges, not a bare greeting or check-in. Variation is
    // deterministic, driven by each character's own grounded
    // identity_substrate (never invented), so a multi-responder social turn
    // does not collapse every teammate onto the same line.
    const socialExpression = person?.identity_substrate?.social_expression ?? null;
    const temperament = person?.identity_substrate?.conversational_temperament ?? null;

    const GREETING_BY_EXPRESSION = {
      "dryly observant": "Hey.",
      "quietly friendly": "Hi there.",
      "carefully polite": "Good morning.",
      "plain-spoken": "Hey.",
      "wry under pressure": "Well, hello."
    };
    const INTRODUCTION_BY_EXPRESSION = {
      "dryly observant": "Noted.",
      "quietly friendly": "Good to meet you.",
      "carefully polite": "Pleasure to meet you.",
      "plain-spoken": "Good to know.",
      "wry under pressure": "Duly noted."
    };
    const ACKNOWLEDGMENT_BY_TEMPERAMENT = {
      "brief and direct": "Got it.",
      "measured and reflective": "Understood.",
      "warm but guarded": "Okay.",
      "talkative when uneasy": "Sounds good.",
      "deadpan": "Noted."
    };
    const SOCIAL_OBSERVATION_BY_TEMPERAMENT = {
      "brief and direct": "I'm fine.",
      "measured and reflective": "Managing, thanks.",
      "warm but guarded": "I'm all right.",
      "talkative when uneasy": "Could be better, could be worse.",
      "deadpan": "Can't complain."
    };

    const socialLines = {
      "joke_or_sarcasm": isSupportive ? `${name}: Fair point.` : `${name}: Let's stay focused.`,
      "greeting": `${name}: ${GREETING_BY_EXPRESSION[socialExpression] ?? (isSupportive ? "Good to see you." : "Hello.")}`,
      "introduction": `${name}: ${INTRODUCTION_BY_EXPRESSION[socialExpression] ?? "Good to know."}`,
      "acknowledgment": `${name}: ${ACKNOWLEDGMENT_BY_TEMPERAMENT[temperament] ?? "Understood."}`,
      "social_observation": isGuarded
        ? `${name}: Let's keep moving.`
        : `${name}: ${SOCIAL_OBSERVATION_BY_TEMPERAMENT[temperament] ?? (isSupportive ? "I'm fine." : "Noted.")}`
    };
    return socialLines[speechAct] ?? `${name}: Understood.`;
  }

  if (isPersonalQ) {
    // Personal question: honest about limited information; never invent biography
    return personality === "nervous-first-day"
      ? `${name}: First time for me too.`
      : personality === "veteran-doctor"
        ? `${name}: I'll keep that to myself for now.`
        : `${name}: Nothing I can confirm from here.`;
  }

  const reportedAcknowledgment = personality === "intern"
    ? `Okay. I have "${statement}" in the notes as your report.`
    : personality === "veteran-doctor"
      ? `Logged as your report: "${statement}". I'll keep it separate from what I've verified.`
      : `Noted. I'm treating "${statement}" as your report until we can confirm it.`;
  const characterAcknowledgment = !isDisclosure && isOperationalReport
    ? reportedAcknowledgment
    : personality === "nervous-first-day"
    ? (isDisclosure ? "Thanks for saying it. I'll speak up early if the space starts getting difficult." : "All right. I'll stay close and tell you what I notice.")
    : personality === "intern"
      ? (isDisclosure ? "Got it. I'll keep that in mind while we work." : "Understood. What do you need from me next?")
      : personality === "veteran-doctor"
        ? (isDisclosure ? "Understood. Tell me early if it starts affecting you." : "Understood. I'll keep my answer to what I can verify.")
        : (isDisclosure ? "Thanks for telling me. I'll keep it in mind." : "Understood. I'll stay with what I can confirm here.");
  const acknowledgmentLine = isSupportive
    ? (isDisclosure ? `${characterAcknowledgment} You can count on me.` : `${characterAcknowledgment} I've got your back.`)
    : isGuarded
      ? (isDisclosure ? "Understood. We'll keep to procedure and address it if it affects the work." : "Understood. I'll stick to what I can directly confirm.")
      : characterAcknowledgment;

  const lines = {
    acknowledgment: acknowledgmentLine,
    warning: "Hold there. I can't safely back that from where we are.",
    // "question" category: factual question only — if hosted AI is unavailable
    question: isFactualQ
      ? (personality === "veteran-doctor" ? "What exactly are you asking me to verify?" : "Which part do you need me to check?")
      : (speechAct === "ambiguous" ? "Sorry — could you say that again?" : "Understood."),
    uncertainty: "I can't confirm more than what I can observe from here."
  };
  return `${name}: ${lines[reaction.category] ?? "Understood."}`;
}

// Semantic decision: does this worker have a relevant known answer for the
// utterance, and what is it? Returns structured data only (no wording), so
// callers can decide relevance/ownership without consulting a string producer.
function resolveKnownAnswer(run, workerId, playerText = "", world = null) {
  const text = String(playerText ?? "");
  const member = memberFor(run, workerId);
  const person = world?.characters?.[workerId] ?? (run?._world?.characters?.[workerId]);
  const name = member?.first_name ?? member?.display_name ?? person?.first_name ?? "Assigned teammate";
  const recallMatch = /\b(?:remember|recall|what did i (?:say|tell|ask)|my (?:communication |working )?preference|call me)\b/i.test(text);
  if (recallMatch) {
    const memories = [
      ...(member?.known_information ?? []).filter((i) => i.kind === "reported-knowledge" || i.text),
      ...(person?.continuity?.dialogue_memories ?? [])
    ];
    if (memories.length > 0) {
      const preferMemory = memories.find((m) => /\b(?:call me|prefer|name|casey|tight spaces|nervous)\b/i.test(m.text || m.player_text || ""));
      const chosen = preferMemory ?? memories.at(-1);
      return { kind: "recalled-player-statement", name, text: chosen.text || chosen.player_text || "" };
    }
  }

  if (/\b(?:what was your (?:reply|response)|what did you (?:say|reply|answer)(?!\s+(?:to|about)\s+(?!me\b)\w)|recall your reply)\b/i.test(text)) {
    // Only the worker's OWN recorded replies are "what I said". Interactions merely heard carry someone
    // else's reply and must never be recalled as one's own.
    const retrieved = retrieveRelevantMemories(person, run?.expedition, { queryText: text, speakerId: workerId, playerId: run?.session?.startup?.player?.observer_id, limit: 8 })
      .filter((memory) => memory.source === "character-dialogue-memory" && memory.response);
    if (retrieved.length > 0) return { kind: "recalled-own-reply", name, text: retrieved[0].response };
  }

  if (!/\b(?:what happened|what did you (?:find|see|observe)|while (?:we were )?(?:apart|separated)|report what happened)\b/i.test(text)) return null;
  if (!member) return null;
  const direct = (member.known_information ?? []).filter((item) => item.source === "direct-observation" && item.kind !== "custody-observed").at(-1) ?? null;
  const condition = (member.condition_history ?? []).at(-1) ?? null;
  if (!direct && !condition) return null;
  return { kind: "own-report", name, direct, condition };
}

// Wording for a resolved known answer. Never consulted for eligibility, owners
// or relevance.
function presentKnownAnswer(run, workerId, playerText = "", world = null) {
  const answer = resolveKnownAnswer(run, workerId, playerText, world);
  if (!answer) return null;
  if (answer.kind === "recalled-player-statement") return `${answer.name}: I remember what you told me: \u201c${answer.text}\u201d.`;
  if (answer.kind === "recalled-own-reply") return `${answer.name}: I replied: \u201c${answer.text}\u201d.`;
  const { direct, condition } = answer;
  const clauses = [];
  if (direct?.kind === "location-investigated" && direct.location) clauses.push(`I checked the ${String(direct.location).replace(/-/g, " ")}.`);
  else if (direct?.target) clauses.push(`I inspected ${String(direct.target).replace(/-/g, " ")}.`);
  if (condition?.reason) clauses.push(`I was ${String(condition.reason).replace(/[.!?]+$/, "")}.`);
  if (condition?.condition && String(condition.condition).toLowerCase() !== "normal") clauses.push(`My current condition is ${String(condition.condition).replace(/-/g, " ")}.`);
  return `${answer.name}: ${clauses.join(" ")}`;
}

function decisionContext({ world, run, phase, worker_id, request = {} }) {
  const worker = ensurePerson(world, run?.run_id, worker_id); const member = memberFor(run, worker_id);
  const location = run?.spatial?.personnel_locations?.[worker_id] ?? null;
  return { valid: Boolean(worker && member), worker, member, phase, location, request: clone(request), equipment: Object.values(run?.expedition?.equipment ?? {}), run };
}

function decide(context) {
  if (!context?.valid) return { state: "unheard", reason: "PERSONNEL_UNKNOWN" };
  const { worker, member, request, phase, location, equipment } = context;
  if (request.received === false) return { state: "unheard", reason: "ORDER_NOT_RECEIVED" };
  if (!FIELD_PHASES.has(phase)) return { state: "cannot-comply", reason: "WRONG_OPERATIONAL_PHASE" };
  if (worker.status !== "active" || member.status !== "active") return { state: "cannot-comply", reason: "PERSONNEL_UNAVAILABLE" };
  if (request.qualification && !worker.continuity.qualifications.includes(request.qualification)) return { state: "cannot-comply", reason: "QUALIFICATION_REQUIRED" };
  if (request.target_location && request.reachable === false) return { state: "cannot-comply", reason: "ROUTE_UNAVAILABLE" };
  if (request.required_equipment && !equipment.some((item) => item.holder === worker.identity && (item.id === request.required_equipment || item.instance_id === request.required_equipment) && ["operational", "serviceable", "usable"].includes(String(item.state).toLowerCase()))) return { state: "cannot-comply", reason: "EQUIPMENT_REQUIRED" };
  if (request.procedural_conflict) return { state: "refused", reason: "PROCEDURE_CONFLICT" };
  if (member.current_task?.state === "active" && !["follow", "wait", "player-directed"].includes(member.current_task.type) && request.type !== "assist") return { state: "delayed", reason: "HIGHER_PRIORITY_TASK" };
  const requester = request.requester ?? context.run?.session?.startup?.player?.observer_id;
  const attitude = context.worker && requester ? getAttitude(context.worker, requester) : null;
  const trustOffset = attitude ? (attitude.trust - 50) * 0.25 : 0;
  const riskThreshold = 76 - worker.continuity.tendencies.procedural_caution * .32 + trustOffset;
  if (bounded(request.perceived_risk ?? 0) >= riskThreshold) return { state: "refused", reason: "RISK_THRESHOLD", threshold: bounded(riskThreshold) };
  return { state: "accepted", reason: "QUALIFIED_OPERATIONAL_COMPLIANCE" };
}

function publicRecord(person, playerId = null) {
  if (!person) return null; const continuity = person.continuity ?? {};
  const shared = (continuity.shared_history ?? []).filter((fact) => fact.participants?.includes(playerId));
  return { role: person.role, qualifications: clone(continuity.qualifications ?? qualifications(person)), status: person.status, assignment_count: person.assignment_history?.length ?? 0, shared_assignment_count: shared.filter((fact) => fact.kind === "served-together").length, relevant_history: shared.slice(-4).map((fact) => ({ kind: fact.kind, refs: clone(fact.refs) })) };
}

module.exports = { VERSION, tendencies, qualifications, samePersonnel, isParticipantOrListener, heardInitiatingUtterance, heardResponseUtterance, defaultAttitude, getAttitude, recordAttitudeChange, retrieveRelevantMemories, ensurePerson, ensureTeam, recordSharedHistory, recordCustody, recordDialogueMemory, reactionContext, salience, react, presentReaction, resolveKnownAnswer, presentKnownAnswer, decisionContext, decide, publicRecord };
