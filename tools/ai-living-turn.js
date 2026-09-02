"use strict";

const { isDeepStrictEqual } = require("node:util");
const { interpretPlayerLanguage, dispatchCandidate } = require("./ai-interpreter-boundary");
const { projectLiveScene } = require("./live-scene-projection");

const VERSION = "yellow-beast-living-turn@v1";
const PRESENTATION_VERSION = "yellow-beast-presentation-candidate@v1";
const PROVIDER_PACKET_VERSION = "yellow-beast-presentation-packet@v1";
const FORBIDDEN_METADATA = /\b(?:canonical[_ -]?geometry|euclidean[_ -]?relation|overlap[_ -]?depth|future[_ -]?(?:event|schedule)|random[_ -]?seed|provider[_ -]?(?:model|metadata|prompt)|migration|debug|semantic[_ -]?(?:id|identifier)|canonical[_ -]?(?:family|type))\b/i;
const FORBIDDEN_INTERNAL_ID = /\b(?:q4|yb-personnel|coordinated|open-passage|utility-room|clear-q4|actor|object|node|edge|fixture|entity)-[a-z0-9][a-z0-9:-]{3,}\b/i;
const CONCLUSION_LANGUAGE = /\b(?:overlap|contradiction|contradicts|conflict(?:s|ing)?|discrepancy|impossible geometry|cannot both be true)\b/i;
const FUTURE_LANGUAGE = /\b(?:will soon|is going to|is about to|later (?:will|does)|next (?:will|comes))\b/i;

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function only(value, keys) {
  return plain(value) && Object.keys(value).every((key) => keys.has(key));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function memberId(member) {
  return member?.personnel_id ?? member?.id ?? null;
}

function words(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

function sentence(value) {
  const text = String(value ?? "").trim();
  return !text || /[.!?]$/.test(text) ? text : `${text}.`;
}

function publicActor(packet, observerId) {
  return packet.visible_personnel.find((person) => person.observer_id === observerId)?.known_identity ?? "A nearby coworker";
}

function visibleActionText(packet, event) {
  const actor = publicActor(packet, event.actor_id);
  const target = String(event.target ?? "the nearby feature").replace(/[-_]+/g, " ");
  const action = String(event.action ?? "acts").toUpperCase();
  if (action === "INSPECT") return `${actor} inspects ${target}.`;
  if (action === "USE") return `${actor} completes the equipment procedure at ${target}.`;
  return `${actor} completes the recorded ${action.toLowerCase()} attempt.`;
}

function safeResolution(resolution, action = null) {
  return {
    action,
    outcome: resolution?.outcome ?? (resolution?.ok ? "succeeded" : "rejected"),
    public_reason: resolution?.result?.public_reason ?? resolution?.public_reason ?? null,
    interval_id: resolution?.result?.interval_id ?? null,
    interval: resolution?.result?.interval ?? null,
    time_advanced: resolution?.result?.time_advanced ?? 0
  };
}

function buildProviderPacket(playerPacket, resolution, action = null) {
  return deepFreeze({
    version: PROVIDER_PACKET_VERSION,
    audience: "controlled-player",
    authority_contract: {
      presentation: "candidate-only",
      canonical_mutation: "forbidden",
      player_speech_or_action_invention: "forbidden",
      hidden_state: "structurally-absent"
    },
    player_scene: structuredClone(playerPacket),
    authoritative_resolution: safeResolution(resolution, action)
  });
}

function fallbackPresentation(providerPacket, reason = null) {
  const packet = providerPacket.player_scene;
  const parts = [];
  if (packet.location.visible_description) parts.push(sentence(packet.location.visible_description));
  else if (packet.location.known_name) parts.push(`You are at ${packet.location.known_name}.`);
  for (const condition of packet.visible_environment.visible_conditions ?? []) parts.push(sentence(condition));
  if (providerPacket.authoritative_resolution.public_reason) parts.push(sentence(providerPacket.authoritative_resolution.public_reason));
  for (const event of packet.recent_observable_events ?? []) {
    if (event.actor_id !== packet.observer_id) parts.push(visibleActionText(packet, event));
  }
  if (!parts.length) parts.push("From your present position, the interval produces no further confirmed change.");
  return deepFreeze({
    version: PRESENTATION_VERSION,
    scene_description: parts.join(" "),
    npc_presentations: [],
    presentation_claims: [],
    source: "deterministic-fallback",
    fallback_reason: reason
  });
}

function candidateShape(candidate) {
  if (!only(candidate, new Set(["version", "scene_description", "npc_presentations", "presentation_claims"]))) return false;
  if (candidate.version !== PRESENTATION_VERSION || typeof candidate.scene_description !== "string" || !candidate.scene_description.trim() || candidate.scene_description.length > 2400) return false;
  if (!Array.isArray(candidate.npc_presentations) || candidate.npc_presentations.length > 12) return false;
  if (!candidate.npc_presentations.every((item) => only(item, new Set(["observer_id", "speech", "visible_action"]))
    && typeof item.observer_id === "string"
    && (!Object.hasOwn(item, "speech") || item.speech === null || typeof item.speech === "string")
    && (!Object.hasOwn(item, "visible_action") || item.visible_action === null || typeof item.visible_action === "string")
    && (Boolean(item.speech?.trim()) || Boolean(item.visible_action?.trim())))) return false;
  if (!Array.isArray(candidate.presentation_claims) || candidate.presentation_claims.length > 24) return false;
  return candidate.presentation_claims.every((claim) => only(claim, new Set(["source", "text"])) && typeof claim.source === "string" && typeof claim.text === "string" && claim.text.trim().length > 0);
}

function candidateText(candidate) {
  return [candidate.scene_description, ...candidate.npc_presentations.flatMap((item) => [item.speech, item.visible_action]), ...candidate.presentation_claims.flatMap((claim) => [claim.source, claim.text])].filter(Boolean).join("\n");
}

function knownNumbers(providerPacket) {
  return new Set((JSON.stringify(providerPacket).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number));
}

function validatePresentation(providerPacket, candidate) {
  if (!candidateShape(candidate)) return { ok: false, code: "PRESENTATION_SCHEMA_INVALID" };
  const packet = providerPacket.player_scene;
  const text = candidateText(candidate);
  if (FORBIDDEN_METADATA.test(text) || FORBIDDEN_INTERNAL_ID.test(text)) return { ok: false, code: "PRESENTATION_INTERNAL_METADATA" };
  if (FUTURE_LANGUAGE.test(text)) return { ok: false, code: "PRESENTATION_FUTURE_EVENT" };
  const conclusions = packet.observer_knowledge.established_conclusions.map((item) => item.conclusion).filter(Boolean).join(" ");
  if (CONCLUSION_LANGUAGE.test(text) && !CONCLUSION_LANGUAGE.test(conclusions)) return { ok: false, code: "PRESENTATION_UNESTABLISHED_CONCLUSION" };
  const allowedNumbers = knownNumbers(providerPacket);
  if ((text.match(/-?\d+(?:\.\d+)?/g) ?? []).some((value) => !allowedNumbers.has(Number(value)))) return { ok: false, code: "PRESENTATION_UNOBSERVED_MEASUREMENT" };
  const supportText = words(JSON.stringify(providerPacket));
  const protectedNouns = text.toLowerCase().match(/\b(?:door|corridor|passage|room|chamber|fixture|object|panel|grade|instrument|camera|radio|personnel|worker|light|equipment|measurement|route|annex|transition|wall|floor|ceiling|opening|entity|creature|phenomenon)\b/g) ?? [];
  if (protectedNouns.some((term) => !supportText.includes(term))) return { ok: false, code: "PRESENTATION_OBJECT_OR_GEOGRAPHY_UNKNOWN" };

  const visible = new Map(packet.visible_personnel.map((person) => [person.observer_id, person]));
  const delivered = packet.communication_context.recent_messages ?? [];
  const events = packet.recent_observable_events ?? [];
  for (const item of candidate.npc_presentations) {
    const person = visible.get(item.observer_id);
    if (!person || item.observer_id === packet.observer_id) return { ok: false, code: "PRESENTATION_SPEAKER_IMPOSSIBLE" };
    if (item.speech) {
      const supported = delivered.some((message) => message.sender === person.known_identity && message.text === item.speech && ["delivered", "acknowledged"].includes(message.state));
      if (!supported) return { ok: false, code: "PRESENTATION_SPEECH_UNDELIVERED" };
    }
    if (item.visible_action) {
      const supported = events.filter((event) => event.actor_id === item.observer_id).some((event) => words(item.visible_action) === words(visibleActionText(packet, event)));
      if (!supported) return { ok: false, code: "PRESENTATION_ACTION_IMPOSSIBLE" };
    }
  }

  const knownNames = new Set([
    packet.location.known_name,
    ...packet.visible_personnel.map((person) => person.known_identity),
    ...delivered.flatMap((message) => [message.sender, message.recipient]),
    "Standard"
  ].filter(Boolean));
  const properNames = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  if (properNames.some((name) => !knownNames.has(name))) return { ok: false, code: "PRESENTATION_PERSONNEL_UNKNOWN" };
  const knownFirstNames = new Set(packet.visible_personnel.map((person) => person.known_identity.split(/\s+/)[0]));
  const attributedNames = [...text.matchAll(/\b([A-Z][a-z]+)\s+(?:says?|speaks?|replies|answers|asks?|reports?|notices?|observes?|sees|hears|finds|holds|carries|uses)\b/g)].map((match) => match[1]);
  if (attributedNames.some((name) => !knownFirstNames.has(name) && !["Standard", "You"].includes(name))) return { ok: false, code: "PRESENTATION_PERSONNEL_UNKNOWN" };
  for (const person of packet.visible_personnel.filter((item) => item.observer_id !== packet.observer_id)) {
    const privateClaim = new RegExp(`\\b(?:${person.known_identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${person.known_identity.split(/\s+/)[0]})\\s+(?:found|noticed|observed|saw|heard|concluded|determined|reports?|says?|holds|carries|uses)\\b`, "i");
    if (privateClaim.test(text) && !delivered.some((message) => message.sender === person.known_identity && text.includes(message.text))) return { ok: false, code: "PRESENTATION_PRIVATE_OBSERVER_KNOWLEDGE" };
    const visibleActivity = new RegExp(`\\b(?:${person.known_identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${person.known_identity.split(/\s+/)[0]})\\s+(?:inspects?|moves?|walks?|runs?|enters?|leaves?|opens?|closes?|photographs?)\\b`, "i");
    if (visibleActivity.test(text) && !events.filter((event) => event.actor_id === person.observer_id).some((event) => text.includes(visibleActionText(packet, event)))) return { ok: false, code: "PRESENTATION_ACTION_IMPOSSIBLE" };
  }

  const playerEvent = events.find((event) => event.actor_id === packet.observer_id);
  const inventedPlayer = /\byou (?:say|speak|tell|ask|reply|answer|decide|realize|conclude|notice|walk|run|move|arrive|turn|reach|inspect|measure|photograph|pick up|take|use)\b/i.exec(text);
  if (inventedPlayer) {
    const action = String(playerEvent?.action ?? providerPacket.authoritative_resolution.action ?? "").toLowerCase();
    const phrase = inventedPlayer[0].toLowerCase();
    const supported = (action === "USE" && /(?:measure|use)$/.test(phrase)) || (action === "MOVE" && /(?:walk|run|move|arrive)$/.test(phrase)) || (action === "INSPECT" && phrase.endsWith("inspect")) || (action === "PHOTOGRAPH" && phrase.endsWith("photograph"));
    if (!supported) return { ok: false, code: "PRESENTATION_PLAYER_AGENCY_INVENTED" };
  }
  const quoted = text.match(/["“]([^"”]{1,400})["”]/g) ?? [];
  if (quoted.length && !quoted.every((quote) => delivered.some((message) => quote.includes(message.text)))) return { ok: false, code: "PRESENTATION_SPEECH_UNDELIVERED" };
  return { ok: true, candidate: deepFreeze(structuredClone(candidate)) };
}

async function executeLivingTurn({ run, player_text, interpreter, presentation_provider = interpreter, request_id = null } = {}) {
  const trace = [];
  const beforeInterpretation = structuredClone(run);
  trace.push("interpreter");
  const interpretation = await interpretPlayerLanguage({ run, player_text, interpreter, request_id });
  if (!isDeepStrictEqual(run, beforeInterpretation)) throw new Error("INTERPRETATION_MUTATED_CANON");
  if (interpretation.kind === "clarification") return deepFreeze({ version: VERSION, status: "clarification", player_input: player_text, interpretation, trace, canonical_mutation: false });

  trace.push("resolution");
  const resolution = dispatchCandidate(run, interpretation);
  if (!resolution.ok) return deepFreeze({ version: VERSION, status: "rejected", player_input: player_text, interpretation, resolution: structuredClone(resolution), trace, canonical_mutation: false });
  const afterResolution = structuredClone(run);

  trace.push("projection");
  const packets = {};
  for (const member of run.expedition?.team?.members ?? []) {
    const observerId = memberId(member);
    const projected = projectLiveScene(run, { observer_id: observerId });
    if (projected.ok) packets[observerId] = projected.packet;
  }
  const playerId = run.session?.startup?.player?.observer_id;
  const playerPacket = packets[playerId];
  if (!playerPacket) throw new Error("PLAYER_LIVE_SCENE_UNAVAILABLE");
  if (!isDeepStrictEqual(run, afterResolution)) throw new Error("PROJECTION_MUTATED_CANON");
  const resolvedPlayerAction = interpretation.sink.kind === "custodian-action@v1" ? interpretation.sink.payload.action : interpretation.sink.payload.player_attempt?.action ?? null;
  const providerPacket = buildProviderPacket(playerPacket, resolution, resolvedPlayerAction);

  let candidate;
  trace.push("presentation");
  try {
    if (typeof presentation_provider?.present !== "function") throw new Error("presentation provider unavailable");
    candidate = await presentation_provider.present(structuredClone(providerPacket));
  } catch {
    candidate = null;
  }
  if (!isDeepStrictEqual(run, afterResolution)) throw new Error("GENERATION_MUTATED_CANON");
  trace.push("validation");
  const validation = validatePresentation(providerPacket, candidate);
  const presentation = validation.ok ? deepFreeze({ ...validation.candidate, source: "provider", fallback_reason: null }) : fallbackPresentation(providerPacket, validation.code);
  if (!isDeepStrictEqual(run, afterResolution)) throw new Error("VALIDATION_MUTATED_CANON");
  return deepFreeze({
    version: VERSION,
    status: "resolved",
    player_input: player_text,
    interpretation,
    resolution: safeResolution(resolution, resolvedPlayerAction),
    observer_packets: packets,
    provider_packet: providerPacket,
    presentation,
    validation: { accepted: validation.ok, code: validation.ok ? null : validation.code },
    trace,
    canonical_mutation: true
  });
}

module.exports = {
  VERSION,
  PRESENTATION_VERSION,
  PROVIDER_PACKET_VERSION,
  buildProviderPacket,
  fallbackPresentation,
  validatePresentation,
  executeLivingTurn,
  visibleActionText
};
