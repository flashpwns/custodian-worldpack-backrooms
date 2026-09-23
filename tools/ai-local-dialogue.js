"use strict";

// LOCAL language generation is presentation-only. Personnel continuity
// decides whether a particular coworker responds before this packet exists;
// the provider may only phrase that already-authorized response.
const canonicalLedger = require("./canonical-world-ledger");
const { projectLiveScene, projectObserverState } = require("./live-scene-projection");
const { isParticipantOrListener, heardInitiatingUtterance, heardResponseUtterance, getAttitude, retrieveRelevantMemories } = require("./q4-personnel-continuity");
const { interpretUtterance, resolveResponsePurpose, selectRelevantContext, resolveReportPurpose } = require("./dialogue-interpretation");

const PACKET_VERSION = "yellow-beast-local-dialogue-packet@v1";
const CANDIDATE_VERSION = "yellow-beast-local-dialogue-candidate@v1";
const REPORT_PACKET_VERSION = "yellow-beast-observation-report-packet@v1";
const FORBIDDEN_METADATA = /\b(?:canonical[_ -]?geometry|euclidean[_ -]?relation|overlap[_ -]?depth|future[_ -]?(?:event|schedule)|random[_ -]?seed|provider[_ -]?(?:model|metadata|prompt)|migration|debug|semantic[_ -]?(?:id|identifier)|canonical[_ -]?(?:family|type))\b/i;
const FORBIDDEN_INTERNAL_ID = /\b(?:q4|yb-personnel|coordinated|open-passage|utility-room|clear-q4|actor|object|node|edge|fixture|entity)-[a-z0-9][a-z0-9:-]{3,}\b/i;
const INVENTED_PLAYER = /\byou (?:say|said|speak|spoke|ask|asked|reply|replied|answer|answered|decide|decided|realize|realized|conclude|concluded|notice|noticed|walk|walked|run|ran|move|moved|arrive|arrived|turn|turned|reach|reached|inspect|inspected|measure|measured|photograph|photographed|take|took|use|used)\b/i;
const UNSUPPORTED_FACTUAL_SPEECH = /\b(?:there (?:is|are|'s)|i (?:know|served|worked|was stationed|have been)|we (?:know|mapped|confirmed)|the (?:exit|route|door|passage|room|corridor) (?:is|leads|goes|opens)|(?:will|going to) (?:happen|arrive|open|close))\b/i;

const EQUIPMENT_KEYWORDS = [
  { term: "camera", id: "recording-device" },
  { term: "recording-device", id: "recording-device" },
  { term: "survey-instrument", id: "survey-instrument" },
  { term: "survey instrument", id: "survey-instrument" },
  { term: "instrument", id: "survey-instrument" },
  { term: "radio", id: "survey-radio" },
  { term: "survey-radio", id: "survey-radio" },
  { term: "flashlight", id: "field-light" },
  { term: "field-light", id: "field-light" }
];

const POSSESSION_PATTERNS = [
  /\b(?:i have|i've got|i hold|i am holding|holding|with me|my custody|in my custody|my hands|i took|i carry)\b.{0,35}\b(camera|recording-device|survey-instrument|survey instrument|instrument|radio|survey-radio|flashlight|field-light)\b/i,
  /\b(camera|recording-device|survey-instrument|survey instrument|instrument|radio|survey-radio|flashlight|field-light)\b.{0,35}\b(?:is with me|in my hands|with me|in my bag|in my custody)\b/i
];

const DISPOSAL_OR_LOCATION_PATTERNS = [
  /\b(?:i left|i dropped|i placed|i set down)\b.{0,35}\b(camera|recording-device|survey-instrument|survey instrument|instrument|radio|survey-radio|flashlight|field-light)\b/i
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function getRecentDialogue(expedition, playerId, speakerId, limit = 6, pendingInteractionId = null) {
  if (!expedition?.interaction_history) return [];
  const results = [];
  for (const entry of expedition.interaction_history) {
    // The current player message has its own packet field. Its provisional
    // fallback must not masquerade as an already delivered coworker reply.
    if (pendingInteractionId && entry.id === pendingInteractionId) continue;
    if (entry.channel !== "local") continue;
    const heardInit = heardInitiatingUtterance(entry, speakerId);
    const heardResp = heardResponseUtterance(entry, speakerId);
    if (!heardInit && !heardResp) continue;

    // A committed group turn may carry several responders in
    // entry.responses[] (canonical owner order). Represent each committed
    // response as its own row rather than collapsing to the first one, so a
    // later responder can see the full heard exchange, not just one line of
    // it. The player utterance is attached once, to the first row, so it is
    // never duplicated across responder rows.
    const committed = heardResp && Array.isArray(entry.responses) && entry.responses.length > 0
      ? entry.responses
      : null;
    if (committed) {
      committed.forEach((item, index) => {
        results.push({
          id: entry.id,
          player_text: index === 0 && heardInit ? (entry.player_text ?? null) : null,
          response: item.text ?? null,
          speaker: item.speaker_name ?? null
        });
      });
    } else {
      results.push({
        id: entry.id,
        player_text: heardInit ? (entry.player_text ?? null) : null,
        response: heardResp ? (entry.presentation?.response ?? entry.response ?? null) : null,
        speaker: heardResp ? (entry.response_speaker ?? null) : null
      });
    }
  }
  return results.slice(-limit);
}

function buildLocalDialoguePacket(context) {
  const { run, player_text, speaker, person, reaction_context, reaction, interpretation: suppliedInterpretation } = context;
  const playerId = run.session.startup.player.observer_id;
  const speakerId = speaker.personnel_id ?? speaker.id;
  const isGroup = context.is_group ?? false;

  // ── 1. Bounded interpretation (prefer supplied; derive if absent) ──────
  const interpretation = (suppliedInterpretation?.version)
    ? suppliedInterpretation
    : interpretUtterance(String(player_text ?? "").trim(), { isGroup });

  // ── 2. Response purpose — deterministic, not left to the model ─────────
  const response_purpose = resolveResponsePurpose(interpretation, reaction?.category ?? "acknowledgment");

  // ── 3. Observer projections ────────────────────────────────────────────
  const speakerProjected = projectObserverState(run, speakerId, "coworker-mini-shell");
  if (!speakerProjected.ok) throw new Error(speakerProjected.error?.code ?? "SPEAKER_OBSERVER_SHELL_UNAVAILABLE");

  const playerProjected = projectLiveScene(run, { observer_id: playerId });
  if (!playerProjected.ok) throw new Error(playerProjected.error?.code ?? "PLAYER_LIVE_SCENE_UNAVAILABLE");
  const visibleSpeaker = playerProjected.packet.visible_personnel.find((item) => item.observer_id === speakerId);
  if (!visibleSpeaker) throw new Error("LOCAL_SPEAKER_NOT_VISIBLE");

  // ── 4. Memory / fact retrieval with relevance filtering ───────────────
  const publicContinuity = person?.continuity ?? {};
  const recentDialogue = getRecentDialogue(run.expedition, playerId, speakerId, 6, context.interaction?.id);

  const rawRelevantMemories = retrieveRelevantMemories(person, run.expedition, {
    queryText: player_text,
    speakerId,
    playerId,
    limit: 5,
    excludeRecent: recentDialogue
  });

  const knownFacts = (speaker.known_information ?? []).filter((f) => f.kind !== "reported-knowledge" || f.source === "direct-observation");
  const { relevant_memories, relevant_facts, forbidden_topics } = selectRelevantContext(
    interpretation,
    rawRelevantMemories,
    knownFacts
  );

  // ── 5. Combine memories (relevant first, then recent base) ────────────
  const baseMemories = (person?.continuity?.dialogue_memories ?? []).slice(-6).map((m) => ({
    player_text: m.player_text,
    response: m.response,
    sender: m.sender
  }));

  const memoryMap = new Map();
  for (const rm of relevant_memories) {
    const key = rm.id || `${rm.player_text}:${rm.response}`;
    memoryMap.set(key, {
      player_text: rm.player_text,
      response: rm.response,
      sender: rm.sender ?? rm.speaker,
      relevance: "explicit-query-match"
    });
  }
  for (const bm of baseMemories) {
    const key = bm.id || `${bm.player_text}:${bm.response}`;
    if (!memoryMap.has(key)) memoryMap.set(key, bm);
  }
  const combinedMemories = [...memoryMap.values()];

  // ── 6. Relationship ───────────────────────────────────────────────────
  const attitude = getAttitude(person, playerId);
  const relationship = attitude ? {
    trust: attitude.trust,
    rapport: attitude.rapport,
    disposition: attitude.disposition,
    sentiment: attitude.sentiment,
    recent_attribution: attitude.attributions?.at(-1)?.reason ?? null
  } : null;

  // ── 7. Assemble the model-facing packet ───────────────────────────────
  // INVARIANT: Raw run object MUST NOT appear in any enumerable field.
  // _run is strictly non-enumerable and used only by validators.

  // Social speech acts receive a reduced operational context. The model only
  // needs speaker identity and the social situation; visible objects, held
  // equipment, current task, and qualifications anchor responses to factual
  // content and are inappropriate for purely social exchanges.
  const isSocialAct = ["joke_or_sarcasm", "greeting", "introduction", "acknowledgment", "social_observation"].includes(interpretation.speech_act);

  const packet = {
    version: PACKET_VERSION,
    audience: "controlled-player",
    authority_contract: {
      presentation: "candidate-only",
      response_authorization: "personnel-continuity-only",
      canonical_mutation: "forbidden",
      player_speech_or_action_invention: "forbidden",
      hidden_state: "structurally-absent"
    },
    player_message: {
      text: String(player_text ?? "").trim().slice(0, 2000),
      state: "delivered",
      channel: "LOCAL"
    },
    // ── Bounded interpretation (model is told what kind of exchange this is) ──
    player_speech_act: {
      speech_act: interpretation.speech_act,
      topic: interpretation.topic,
      tone: interpretation.tone,
      literal_question: interpretation.literal_question,
      confidence: interpretation.confidence
    },
    speaker: {
      observer_id: speakerId,
      known_identity: visibleSpeaker.known_identity,
      role: visibleSpeaker.role_if_known,
      visible_condition: visibleSpeaker.visible_condition,
      // Operational task/equipment/qualifications suppressed for social acts
      // to prevent the model from converting social remarks into briefings.
      current_task: isSocialAct ? null : (reaction_context?.worker?.task ?? null),
      held_equipment: isSocialAct ? [] : (reaction_context?.equipment ?? []),
      qualifications: isSocialAct ? [] : (reaction_context?.worker?.qualifications ?? []),
      characterization: {
        archetype: person?.archetype ?? null,
        personality: person?.personality ?? null,
        primary_task: person?.primary_task ?? null,
        identity_substrate: person?.identity_substrate ?? null
      },
      tendencies: person?.continuity?.tendencies ?? reaction_context?.worker?.tendencies ?? {},
      relationship,
      memories: combinedMemories,
      relevant_memories: relevant_memories.map((rm) => ({
        player_text: rm.player_text,
        response: rm.response,
        sender: rm.sender ?? rm.speaker,
        at: rm.at
      })),
      recent_dialogue: recentDialogue,
      shared_history: (publicContinuity.shared_history ?? [])
        .filter((item) => item.participants?.includes(playerId))
        .slice(-4)
        .map((item) => ({ kind: item.kind }))
    },
    // ── Relevant known facts (pre-filtered by selectRelevantContext) ──────
    known_facts: relevant_facts.map((f) => ({
      kind: f.kind ?? "reported-knowledge",
      text: String(f.text ?? "").slice(0, 400)
    })),
    // ── Topics excluded from this response (model must not invent these) ──
    forbidden_knowledge: forbidden_topics.length > 0 ? forbidden_topics : null,
    // ── Already-accepted responses from earlier responders THIS canonical
    // turn (owner order). Read-only: committed speech only, never a raw or
    // uncommitted candidate. Lets a later responder avoid a verbatim repeat
    // without being able to choose whether it responds or alter any fact.
    same_turn_prior_responses: Array.isArray(context.same_turn_prior_responses)
      ? context.same_turn_prior_responses.map((item) => ({
          speaker_id: item.speaker_id ?? null,
          speaker_name: item.speaker_name ?? null,
          text: item.text ?? null
        }))
      : [],
    visible_context: {
      location: speakerProjected.packet.physical.location,
      environment: playerProjected.packet.visible_environment,
      // Visible objects suppressed for social acts: the object list provides
      // operational texture that is irrelevant to social exchanges and can
      // anchor the model to equipment/fixture details inappropriately.
      visible_objects: isSocialAct ? [] : speakerProjected.packet.physical.visible_objects
    },
    // speaker_shell elided for social acts (it duplicates the reduced speaker
    // block and carries the full visible object list). Preserved for informational
    // acts where the model may need location and equipment provenance detail.
    speaker_shell: isSocialAct ? null : speakerProjected.packet,
    authorized_response: {
      category: reaction?.category ?? "acknowledgment",
      purpose: response_purpose,
      new_factual_claims: "forbidden"
    }
  };

  const cloned = structuredClone(packet);

  // _run is non-enumerable — never serialized, never JSON.stringify'd,
  // never visible to the model. Used only by validateLocalDialogue.
  Object.defineProperty(cloned, "_run", { configurable: true, enumerable: false, value: run });

  // _dialogue_trace is non-enumerable, dev-only context for pipeline introspection.
  Object.defineProperty(cloned, "_dialogue_trace", {
    configurable: true,
    enumerable: false,
    value: Object.freeze({
      raw_utterance: String(player_text ?? "").trim(),
      interpretation: { ...interpretation },
      response_purpose,
      forbidden_topics,
      relevant_facts_count: relevant_facts.length,
      relevant_memories_count: relevant_memories.length,
      reaction_category: reaction?.category ?? null
    })
  });

  return deepFreeze(cloned);
}

// Sibling of buildLocalDialoguePacket for an autonomous NPC observation
// report. Deliberately separate: the player-response packet requires
// player_text and throws when the player cannot see the speaker, but an
// autonomous report may legitimately be spoken with the player absent or
// elsewhere. Everything the report says is authorized before this packet is
// built (speech-scheduler.js's queue entry) -- the model only wordsmiths it.
function buildObservationReportPacket(context) {
  const { run, observer_id, feature_id, purpose, disposition } = context;
  const member = canonicalLedger.getObserverMember(run, observer_id);
  const speakerProjected = projectObserverState(run, observer_id, "coworker-mini-shell");
  if (!speakerProjected.ok) throw new Error(speakerProjected.error?.code ?? "SPEAKER_OBSERVER_SHELL_UNAVAILABLE");

  const obsEntry = run.observation_state?.observers?.[observer_id]?.features?.[feature_id] ?? null;
  const kind = String(feature_id).split(":")[0];
  const canonicalId = String(feature_id).slice(kind.length + 1);

  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const heardHistory = playerId ? getRecentDialogue(run.expedition, playerId, observer_id, 4) : [];

  const packet = {
    version: REPORT_PACKET_VERSION,
    audience: "autonomous-npc-report",
    authority_contract: {
      presentation: "candidate-only",
      report_authorization: "speech-scheduler-only",
      canonical_mutation: "forbidden",
      player_speech_or_action_invention: "forbidden",
      hidden_state: "structurally-absent"
    },
    speaker: {
      observer_id,
      known_identity: member?.first_name ?? member?.display_name ?? null,
      role: member?.role ?? null
    },
    channel: "LOCAL",
    physical_situation: {
      location: speakerProjected.packet.physical.location,
      visible_objects: speakerProjected.packet.physical.visible_objects
    },
    authorized_observation: {
      kind,
      subject: canonicalId,
      state: obsEntry?.state ?? "RECOGNIZED",
      recognized_via: obsEntry?.recognition?.qualification ?? null
    },
    report_purpose: {
      purpose,
      disposition,
      wording_instruction: resolveReportPurpose(purpose)
    },
    heard_history: heardHistory,
    forbidden_knowledge: ["canonical_geometry", "future_events", "other_observers_private_state", "provider_metadata"]
  };

  const cloned = structuredClone(packet);
  Object.defineProperty(cloned, "_run", { configurable: true, enumerable: false, value: run });
  return deepFreeze(cloned);
}

function samePersonnel(id1, id2) {
  if (!id1 || !id2) return false;
  if (id1 === id2) return true;
  return id1 === `personnel-${id2}` || id2 === `personnel-${id1}`;
}

function validateDialogueClaims(packet, candidate, run) {
  if (!run || !candidate?.speech) return { ok: true };
  const speakerId = packet.speaker?.observer_id;
  const speech = candidate.speech;

  // 1. Validate equipment custody claims
  for (const pattern of POSSESSION_PATTERNS) {
    const match = speech.match(pattern);
    if (match) {
      const keyword = match[1].toLowerCase();
      const mapping = EQUIPMENT_KEYWORDS.find((item) => item.term === keyword);
      if (mapping) {
        const canonicalHolder = canonicalLedger.getEquipmentHolder(run, mapping.id);
        if (canonicalHolder && !samePersonnel(canonicalHolder, speakerId)) {
          return {
            ok: false,
            code: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION",
            reason: `Speaker ${speakerId} claimed possession of ${mapping.id}, but canonical holder is ${canonicalHolder}.`
          };
        }
      }
    }
  }

  for (const pattern of DISPOSAL_OR_LOCATION_PATTERNS) {
    const match = speech.match(pattern);
    if (match) {
      const keyword = match[1].toLowerCase();
      const mapping = EQUIPMENT_KEYWORDS.find((item) => item.term === keyword);
      if (mapping) {
        const canonicalHolder = canonicalLedger.getEquipmentHolder(run, mapping.id);
        if (!samePersonnel(canonicalHolder, speakerId)) {
          return {
            ok: false,
            code: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION",
            reason: `Speaker ${speakerId} claimed to have placed/left ${mapping.id}, but lacks custody.`
          };
        }
      }
    }
  }

  // 2. Validate unobserved event claims
  const directObs = canonicalLedger.getObserverObservations(run, speakerId);
  const reportedKnowledge = canonicalLedger.getObserverReportedKnowledge(run, speakerId);

  const sawMatch = speech.match(/\b(?:i saw|i inspected|i observed|i checked|i noticed)\b.{1,35}\b(fixture|fluorescent fixture|scuff|scuff mark|distortion|seam|door|stair|grade|passage|offset)\b/i);
  if (sawMatch) {
    const target = sawMatch[1].toLowerCase();
    const hasObserved = directObs.some((item) => String(item.target ?? "").toLowerCase().includes(target));
    const isCurrentlyVisible = (packet.visible_context?.visible_objects ?? []).some((obj) => String(obj.name ?? "").toLowerCase().includes(target));
    if (!hasObserved && !isCurrentlyVisible) {
      return {
        ok: false,
        code: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION",
        reason: `Speaker ${speakerId} claimed direct observation of ${target} without prior direct observation or current visibility.`
      };
    }
  }

  const eventMatch = speech.match(/\b(?:photographed|measured|reading of|offset of|depth of)\b.{0,30}\b(fixture|fluorescent fixture|passage|corridor)\b/i);
  if (eventMatch) {
    const term = eventMatch[1].toLowerCase();
    const hasDirect = directObs.some((item) => String(item.target ?? "").toLowerCase().includes(term));
    const hasReported = reportedKnowledge.some((item) => String(item.text ?? "").toLowerCase().includes(term));
    if (!hasDirect && !hasReported) {
      return {
        ok: false,
        code: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION",
        reason: `Speaker ${speakerId} referenced ${term} outcome without direct observation or reported knowledge.`
      };
    }
  }

  return { ok: true };
}

function validateSemanticClaims(claims, speakerId, run) {
  if (!Array.isArray(claims)) {
    return { ok: false, code: "SEMANTIC_CLAIMS_INVALID_FORMAT", reason: "Claims must be an array" };
  }
  if (claims.length > 8) {
    return { ok: false, code: "SEMANTIC_CLAIMS_INVALID_FORMAT", reason: "At most eight claims are permitted" };
  }
  const allowedTypes = new Set(["equipment-possession", "equipment_possession", "location", "direct-observation", "direct_observation", "reported-claim", "reported-observation", "reported_claim", "measurement"]);
  for (const claim of claims) {
    if (!claim || typeof claim !== "object") {
      return { ok: false, code: "SEMANTIC_CLAIMS_INVALID_FORMAT", reason: "Each claim must be an object" };
    }
    const type = claim.type ?? claim.kind;
    const subject = claim.subject ?? claim.observer ?? speakerId;
    if (!allowedTypes.has(type)) {
      return { ok: false, code: "SEMANTIC_CLAIM_TYPE_UNSUPPORTED", claim, reason: `Unsupported semantic claim type: ${type ?? "missing"}.` };
    }

    if (type === "equipment-possession" || type === "equipment_possession") {
      const item = claim.object ?? claim.item_id ?? claim.equipment;
      const canonicalHolder = canonicalLedger.getEquipmentHolder(run, item);
      if (!canonicalHolder || !samePersonnel(canonicalHolder, subject)) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_EQUIPMENT_MISMATCH",
          claim,
          reason: `Subject ${subject} does not hold ${item}; actual holder is ${canonicalHolder ?? "none"}.`
        };
      }
    } else if (type === "location") {
      const targetLoc = claim.location_id ?? claim.location;
      const actualLoc = canonicalLedger.getPersonnelLocation(run, subject);
      if (actualLoc !== targetLoc) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_LOCATION_MISMATCH",
          claim,
          reason: `Subject ${subject} is at ${actualLoc}, not ${targetLoc}.`
        };
      }
    } else if (type === "direct-observation" || type === "direct_observation") {
      const target = claim.target;
      const hasObserved = canonicalLedger.hasObserverObserved(run, subject, target);
      let isVisible = false;
      try {
        const liveScene = projectLiveScene(run, { observer_id: subject });
        if (liveScene.ok) {
          isVisible = (liveScene.packet.visible_objects ?? []).some((obj) =>
            String(obj.name ?? "").toLowerCase().includes(String(target).toLowerCase())
          );
        }
      } catch {}
      if (!hasObserved && !isVisible) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_UNOBSERVED_TARGET",
          claim,
          reason: `Observer ${subject} has no direct observation provenance for ${target}.`
        };
      }
    } else if (type === "reported-claim" || type === "reported-observation" || type === "reported_claim") {
      const prop = claim.proposition ?? claim.target;
      const reportedKnowledge = canonicalLedger.getObserverReportedKnowledge(run, subject);
      const matches = reportedKnowledge.some((item) =>
        String(item.proposition ?? item.text ?? "").toLowerCase().includes(String(prop).toLowerCase())
      );
      if (!matches) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_UNREPORTED_TARGET",
          claim,
          reason: `Observer ${subject} has no reported knowledge provenance for ${prop}.`
        };
      }
    } else if (type === "measurement") {
      const target = claim.target ?? claim.evidence_id;
      const evidenceList = run.expedition?.evidence ?? [];
      const hasMeasurement = evidenceList.some((e) =>
        e.valid === true &&
        e.measurement &&
        (e.id === target || String(e.source_location_name ?? "").toLowerCase().includes(String(target).toLowerCase()) || String(e.type ?? "").toLowerCase().includes(String(target).toLowerCase()))
      );
      if (!hasMeasurement) {
        return {
          ok: false,
          code: "SEMANTIC_CLAIM_UNVERIFIED_MEASUREMENT",
          claim,
          reason: `Observer ${subject} has no verified measurement for ${target}.`
        };
      }
    }
  }

  return { ok: true, claims };
}

function claimCoversSpeech(claim, speech) {
  const normalizedSpeech = String(speech).toLowerCase();
  const quotedText = String(claim?.text ?? "").trim().toLowerCase();
  if (quotedText.length >= 4 && normalizedSpeech.includes(quotedText)) return true;
  const type = claim?.type ?? claim?.kind;
  const subjectText = type === "equipment-possession" || type === "equipment_possession"
    ? claim?.object ?? claim?.item_id ?? claim?.equipment
    : type === "location"
      ? claim?.location_id ?? claim?.location
      : type === "reported-claim" || type === "reported-observation" || type === "reported_claim"
        ? claim?.proposition ?? claim?.target
        : claim?.target ?? claim?.evidence_id;
  const normalizedSubject = String(subjectText ?? "").toLowerCase().replace(/[-_]+/g, " ").trim();
  return normalizedSubject.length >= 3 && normalizedSpeech.replace(/[-_]+/g, " ").includes(normalizedSubject);
}

function validateLocalDialogue(packet, candidate, runValue = null) {
  const keys = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? Object.keys(candidate) : [];
  const requiredKeys = ["version", "observer_id", "speech"];
  const allowedKeys = new Set(["version", "observer_id", "speech", "speech_act", "semantic_claims", "claims", "surface_intent"]);
  if (!requiredKeys.every((k) => k in candidate) || !keys.every((k) => allowedKeys.has(k))) {
    return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  }
  if (candidate.version !== CANDIDATE_VERSION || candidate.observer_id !== packet.speaker.observer_id || typeof candidate.speech !== "string") {
    return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  }
  const speech = candidate.speech.trim();
  if (!speech || speech.length > 600) return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  if (FORBIDDEN_METADATA.test(speech) || FORBIDDEN_INTERNAL_ID.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_INTERNAL_METADATA" };
  if (INVENTED_PLAYER.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_PLAYER_AGENCY_INVENTED" };
  if (/\byou\s+(?:said|say|replied|reply|stated)\s*[:,\s]*["“”]/i.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_PLAYER_SPEECH_INVENTED" };

  const run = runValue ?? packet?._run ?? null;
  if (run) {
    const claims = candidate.semantic_claims ?? candidate.claims;
    if (UNSUPPORTED_FACTUAL_SPEECH.test(speech) && (!Array.isArray(claims) || claims.length === 0)) {
      return { ok: false, code: "LOCAL_PRESENTATION_CLAIM_UNSUPPORTED" };
    }
    if (Array.isArray(claims) && claims.length > 0) {
      const semanticValidation = validateSemanticClaims(claims, candidate.observer_id, run);
      if (!semanticValidation.ok) return semanticValidation;
      if (UNSUPPORTED_FACTUAL_SPEECH.test(speech) && !claims.some((claim) => claimCoversSpeech(claim, speech))) {
        return { ok: false, code: "LOCAL_PRESENTATION_CLAIM_UNSUPPORTED" };
      }
    }
    const claimValidation = validateDialogueClaims(packet, candidate, run);
    if (!claimValidation.ok) return claimValidation;
  }

  return {
    ok: true,
    candidate: deepFreeze({
      version: CANDIDATE_VERSION,
      observer_id: candidate.observer_id,
      speech,
      speech_act: candidate.speech_act ?? null,
      semantic_claims: candidate.semantic_claims ?? candidate.claims ?? [],
      surface_intent: candidate.surface_intent ?? null
    })
  };
}

module.exports = {
  PACKET_VERSION,
  CANDIDATE_VERSION,
  REPORT_PACKET_VERSION,
  getRecentDialogue,
  buildLocalDialoguePacket,
  buildObservationReportPacket,
  validateLocalDialogue,
  validateDialogueClaims,
  validateSemanticClaims
};
