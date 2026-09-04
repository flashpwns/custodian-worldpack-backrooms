"use strict";

// LOCAL language generation is presentation-only. Personnel continuity
// decides whether a particular coworker responds before this packet exists;
// the provider may only phrase that already-authorized response.
const canonicalLedger = require("./canonical-world-ledger");
const { projectLiveScene, projectObserverState } = require("./live-scene-projection");

const PACKET_VERSION = "yellow-beast-local-dialogue-packet@v1";
const CANDIDATE_VERSION = "yellow-beast-local-dialogue-candidate@v1";
const FORBIDDEN_METADATA = /\b(?:canonical[_ -]?geometry|euclidean[_ -]?relation|overlap[_ -]?depth|future[_ -]?(?:event|schedule)|random[_ -]?seed|provider[_ -]?(?:model|metadata|prompt)|migration|debug|semantic[_ -]?(?:id|identifier)|canonical[_ -]?(?:family|type))\b/i;
const FORBIDDEN_INTERNAL_ID = /\b(?:q4|yb-personnel|coordinated|open-passage|utility-room|clear-q4|actor|object|node|edge|fixture|entity)-[a-z0-9][a-z0-9:-]{3,}\b/i;
const INVENTED_PLAYER = /\byou (?:say|said|speak|spoke|ask|asked|reply|replied|answer|answered|decide|decided|realize|realized|conclude|concluded|notice|noticed|walk|walked|run|ran|move|moved|arrive|arrived|turn|turned|reach|reached|inspect|inspected|measure|measured|photograph|photographed|take|took|use|used)\b/i;

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

function buildLocalDialoguePacket({ run, player_text, speaker, person, reaction_context, reaction }) {
  const playerId = run.session?.startup?.player?.observer_id;
  const speakerId = speaker?.personnel_id ?? speaker?.id;

  // Project the speaker's own observer mini-shell
  const speakerProjected = projectObserverState(run, speakerId, "coworker-mini-shell");
  if (!speakerProjected.ok) throw new Error(speakerProjected.error?.code ?? "SPEAKER_OBSERVER_SHELL_UNAVAILABLE");

  // Verify speaker and player are co-located in speaking range
  const playerProjected = projectLiveScene(run, { observer_id: playerId });
  if (!playerProjected.ok) throw new Error(playerProjected.error?.code ?? "PLAYER_LIVE_SCENE_UNAVAILABLE");
  const visibleSpeaker = playerProjected.packet.visible_personnel.find((item) => item.observer_id === speakerId);
  if (!visibleSpeaker) throw new Error("LOCAL_SPEAKER_NOT_VISIBLE");

  const publicContinuity = person?.continuity ?? {};
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
      purpose: reaction?.category === "warning" ? "state a bounded immediate warning" : reaction?.category === "question" ? "ask one relevant bounded follow-up question" : reaction?.category === "uncertainty" ? "state uncertainty without inventing facts" : "acknowledge the message without inventing facts",
      new_factual_claims: "forbidden"
    }
  };
  Object.defineProperty(packet, "_run", { configurable: true, enumerable: false, value: run });
  return deepFreeze(packet);
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

function validateLocalDialogue(packet, candidate, runValue = null) {
  const keys = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? Object.keys(candidate) : [];
  if (keys.length !== 3 || !keys.every((key) => ["version", "observer_id", "speech"].includes(key))) return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  if (candidate.version !== CANDIDATE_VERSION || candidate.observer_id !== packet.speaker.observer_id || typeof candidate.speech !== "string") return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  const speech = candidate.speech.trim();
  if (!speech || speech.length > 600) return { ok: false, code: "LOCAL_PRESENTATION_SCHEMA_INVALID" };
  if (FORBIDDEN_METADATA.test(speech) || FORBIDDEN_INTERNAL_ID.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_INTERNAL_METADATA" };
  if (INVENTED_PLAYER.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_PLAYER_AGENCY_INVENTED" };
  if (/["“”]/.test(speech)) return { ok: false, code: "LOCAL_PRESENTATION_PLAYER_SPEECH_INVENTED" };

  const run = runValue ?? packet?._run ?? null;
  if (run) {
    const claimValidation = validateDialogueClaims(packet, candidate, run);
    if (!claimValidation.ok) return claimValidation;
  }

  return { ok: true, candidate: deepFreeze({ version: CANDIDATE_VERSION, observer_id: candidate.observer_id, speech }) };
}

module.exports = {
  PACKET_VERSION,
  CANDIDATE_VERSION,
  buildLocalDialoguePacket,
  validateLocalDialogue,
  validateDialogueClaims
};
