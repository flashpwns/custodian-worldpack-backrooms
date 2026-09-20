"use strict";

// LOCAL language generation is presentation-only. Personnel continuity
// decides whether a particular coworker responds before this packet exists;
// the provider may only phrase that already-authorized response.
const canonicalLedger = require("./canonical-world-ledger");
const { projectLiveScene, projectObserverState } = require("./live-scene-projection");
const { isParticipantOrListener, heardInitiatingUtterance, heardResponseUtterance, getAttitude, retrieveRelevantMemories } = require("./q4-personnel-continuity");

const PACKET_VERSION = "yellow-beast-local-dialogue-packet@v1";
const CANDIDATE_VERSION = "yellow-beast-local-dialogue-candidate@v1";
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

    results.push({
      id: entry.id,
      player_text: heardInit ? (entry.player_text ?? null) : null,
      response: heardResp ? (entry.presentation?.response ?? entry.response ?? null) : null,
      speaker: heardResp ? (entry.response_speaker ?? null) : null
    });
  }
  return results.slice(-limit);
}

function buildLocalDialoguePacket(context) {
  const { run, player_text, speaker, person, reaction_context, reaction } = context;
  const playerId = run.session.startup.player.observer_id;
  const speakerId = speaker.personnel_id ?? speaker.id;

  // Project the speaker's own observer mini-shell
  const speakerProjected = projectObserverState(run, speakerId, "coworker-mini-shell");
  if (!speakerProjected.ok) throw new Error(speakerProjected.error?.code ?? "SPEAKER_OBSERVER_SHELL_UNAVAILABLE");

  // Verify speaker and player are co-located in speaking range
  const playerProjected = projectLiveScene(run, { observer_id: playerId });
  if (!playerProjected.ok) throw new Error(playerProjected.error?.code ?? "PLAYER_LIVE_SCENE_UNAVAILABLE");
  const visibleSpeaker = playerProjected.packet.visible_personnel.find((item) => item.observer_id === speakerId);
  if (!visibleSpeaker) throw new Error("LOCAL_SPEAKER_NOT_VISIBLE");

  const publicContinuity = person?.continuity ?? {};
  const recentDialogue = getRecentDialogue(run.expedition, playerId, speakerId, 6, context.interaction?.id);
  const relevantMemories = retrieveRelevantMemories(person, run.expedition, {
    queryText: player_text,
    speakerId,
    playerId,
    limit: 5,
    excludeRecent: recentDialogue
  });

  const baseMemories = (person?.continuity?.dialogue_memories ?? []).slice(-10).map((m) => ({
    player_text: m.player_text,
    response: m.response,
    sender: m.sender
  }));

  const memoryMap = new Map();
  for (const rm of relevantMemories) {
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
    if (!memoryMap.has(key)) {
      memoryMap.set(key, bm);
    }
  }
  const combinedMemories = [...memoryMap.values()];

  const attitude = getAttitude(person, playerId);
  const relationship = attitude ? {
    trust: attitude.trust,
    rapport: attitude.rapport,
    disposition: attitude.disposition,
    sentiment: attitude.sentiment,
    recent_attribution: attitude.attributions?.at(-1)?.reason ?? null
  } : null;

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
    player_message: { text: String(player_text ?? "").trim().slice(0, 2000), state: "delivered", channel: "LOCAL" },
    speaker: {
      observer_id: speakerId,
      known_identity: visibleSpeaker.known_identity,
      role: visibleSpeaker.role_if_known,
      visible_condition: visibleSpeaker.visible_condition,
      current_task: reaction_context?.worker?.task ?? null,
      held_equipment: reaction_context?.equipment ?? [],
      qualifications: reaction_context?.worker?.qualifications ?? [],
      characterization: {
        archetype: person?.archetype ?? null,
        personality: person?.personality ?? null,
        primary_task: person?.primary_task ?? null,
        identity_substrate: person?.identity_substrate ?? null
      },
      tendencies: person?.continuity?.tendencies ?? reaction_context?.worker?.tendencies ?? {},
      relationship,
      memories: combinedMemories,
      relevant_memories: relevantMemories.map((rm) => ({
        player_text: rm.player_text,
        response: rm.response,
        sender: rm.sender ?? rm.speaker,
        at: rm.at
      })),
      recent_dialogue: recentDialogue,
      shared_history: (publicContinuity.shared_history ?? []).filter((item) => item.participants?.includes(playerId)).slice(-4).map((item) => ({ kind: item.kind }))
    },
    visible_context: {
      location: speakerProjected.packet.physical.location,
      environment: playerProjected.packet.visible_environment,
      visible_objects: speakerProjected.packet.physical.visible_objects
    },
    speaker_shell: speakerProjected.packet,
    authorized_response: {
      category: reaction?.category ?? "acknowledgment",
      purpose: reaction?.category === "warning" ? "state a bounded immediate warning" : reaction?.category === "question" ? "answer the question if known or ask a relevant clarification" : reaction?.category === "uncertainty" ? "state uncertainty without inventing facts" : "acknowledge the player's message and respond in character without inventing facts",
      new_factual_claims: "forbidden"
    }
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
  getRecentDialogue,
  buildLocalDialoguePacket,
  validateLocalDialogue,
  validateDialogueClaims,
  validateSemanticClaims
};
