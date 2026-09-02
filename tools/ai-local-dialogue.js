"use strict";

// LOCAL language generation is presentation-only.  Personnel continuity
// decides whether a particular coworker responds before this packet exists;
// the provider may only phrase that already-authorized response.
const { projectLiveScene } = require("./live-scene-projection");

const PACKET_VERSION = "yellow-beast-local-dialogue-packet@v1";
const CANDIDATE_VERSION = "yellow-beast-local-dialogue-candidate@v1";
const FORBIDDEN_METADATA = /\b(?:canonical[_ -]?geometry|euclidean[_ -]?relation|overlap[_ -]?depth|future[_ -]?(?:event|schedule)|random[_ -]?seed|provider[_ -]?(?:model|metadata|prompt)|migration|debug|semantic[_ -]?(?:id|identifier)|canonical[_ -]?(?:family|type))\b/i;
const FORBIDDEN_INTERNAL_ID = /\b(?:q4|yb-personnel|coordinated|open-passage|utility-room|clear-q4|actor|object|node|edge|fixture|entity)-[a-z0-9][a-z0-9:-]{3,}\b/i;
const INVENTED_PLAYER = /\byou (?:say|said|speak|spoke|ask|asked|reply|replied|answer|answered|decide|decided|realize|realized|conclude|concluded|notice|noticed|walk|walked|run|ran|move|moved|arrive|arrived|turn|turned|reach|reached|inspect|inspected|measure|measured|photograph|photographed|take|took|use|used)\b/i;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function buildLocalDialoguePacket({ run, player_text, speaker, person, reaction_context, reaction }) {
  const playerId = run.session?.startup?.player?.observer_id;
  const projected = projectLiveScene(run, { observer_id:playerId });
  if (!projected.ok) throw new Error(projected.error?.code ?? "PLAYER_LIVE_SCENE_UNAVAILABLE");
  const speakerId = speaker?.personnel_id ?? speaker?.id;
  const visibleSpeaker = projected.packet.visible_personnel.find((item) => item.observer_id === speakerId);
  if (!visibleSpeaker) throw new Error("LOCAL_SPEAKER_NOT_VISIBLE");
  const publicContinuity = person?.continuity ?? {};
  const packet = {
    version:PACKET_VERSION,
    audience:"controlled-player",
    authority_contract:{
      presentation:"candidate-only",
      response_authorization:"personnel-continuity-only",
      canonical_mutation:"forbidden",
      player_speech_or_action_invention:"forbidden",
      hidden_state:"structurally-absent"
    },
    player_message:{ text:String(player_text ?? "").trim().slice(0, 2000), state:"delivered", channel:"LOCAL" },
    speaker:{
      observer_id:speakerId,
      known_identity:visibleSpeaker.known_identity,
      role:visibleSpeaker.role_if_known,
      visible_condition:visibleSpeaker.visible_condition,
      current_task:reaction_context?.worker?.task ?? null,
      held_equipment:reaction_context?.equipment ?? [],
      qualifications:reaction_context?.worker?.qualifications ?? [],
      shared_history:(publicContinuity.shared_history ?? []).filter((item) => item.participants?.includes(playerId)).slice(-4).map((item) => ({ kind:item.kind }))
    },
    visible_context:{
      location:projected.packet.location,
      environment:projected.packet.visible_environment,
      visible_objects:projected.packet.visible_objects
    },
    authorized_response:{
      category:reaction?.category ?? "acknowledgment",
      purpose:reaction?.category === "warning" ? "state a bounded immediate warning" : reaction?.category === "question" ? "ask one relevant bounded follow-up question" : reaction?.category === "uncertainty" ? "state uncertainty without inventing facts" : "acknowledge the message without inventing facts",
      new_factual_claims:"forbidden"
    }
  };
  return deepFreeze(packet);
}

function validateLocalDialogue(packet, candidate) {
  const keys = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? Object.keys(candidate) : [];
  if (keys.length !== 3 || !keys.every((key) => ["version", "observer_id", "speech"].includes(key))) return { ok:false, code:"LOCAL_PRESENTATION_SCHEMA_INVALID" };
  if (candidate.version !== CANDIDATE_VERSION || candidate.observer_id !== packet.speaker.observer_id || typeof candidate.speech !== "string") return { ok:false, code:"LOCAL_PRESENTATION_SCHEMA_INVALID" };
  const speech = candidate.speech.trim();
  if (!speech || speech.length > 600) return { ok:false, code:"LOCAL_PRESENTATION_SCHEMA_INVALID" };
  if (FORBIDDEN_METADATA.test(speech) || FORBIDDEN_INTERNAL_ID.test(speech)) return { ok:false, code:"LOCAL_PRESENTATION_INTERNAL_METADATA" };
  if (INVENTED_PLAYER.test(speech)) return { ok:false, code:"LOCAL_PRESENTATION_PLAYER_AGENCY_INVENTED" };
  if (/["“”]/.test(speech)) return { ok:false, code:"LOCAL_PRESENTATION_PLAYER_SPEECH_INVENTED" };
  return { ok:true, candidate:deepFreeze({ version:CANDIDATE_VERSION, observer_id:candidate.observer_id, speech }) };
}

module.exports = { PACKET_VERSION, CANDIDATE_VERSION, buildLocalDialoguePacket, validateLocalDialogue };
