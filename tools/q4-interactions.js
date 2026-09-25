"use strict";

const VERSION = "yellow-beast-q4-interaction-envelope@v2";
const CHANNELS = Object.freeze(["action", "local", "standard"]);
const clone = (value) => structuredClone(value);

function record(expedition, { channel, speaker = "You", speaker_id = null, targets = [], recipient_type = null, recipient_id = null, recipient_ids = [], listeners = [], player_text = null, attempted_behavior = null, eligibility = "eligible", delivery = "not-applicable", time_cost = 0, canonical_effects = [], observer_knowledge = [], presentation = {}, response_speaker = null, response_speaker_id = null, response_owners = [], responses = [], response_listeners = [], location_id = null, submission_id = null, source = "player", requested_action = null, address = null }) {
  if (!expedition || !CHANNELS.includes(channel)) throw new Error("Q4 interaction requires a supported channel");
  expedition.interaction_history ??= [];
  const interaction = {
    version: VERSION,
    id: `q4-interaction-${expedition.interaction_history.length + 1}`,
    submission_id,
    // "player" (a player-initiated exchange) or "autonomous-observation" (an
    // unprompted NPC report committed by speech-scheduler.js). Internal
    // bookkeeping only -- publicEntry carries it through but does not
    // interpret it; the LOCAL rail renders both the same way.
    source,
    channel,
    speaker,
    speaker_id,
    targets: [...targets],
    recipient_type,
    recipient_id,
    recipient_ids: [...recipient_ids],
    listeners: [...listeners],
    player_text,
    attempted_behavior,
    eligibility,
    delivery,
    time_cost,
    canonical_effects: [...canonical_effects],
    observer_knowledge: clone(observer_knowledge),
    presentation: clone(presentation),
    response_speaker,
    response_speaker_id,
    response_owners: clone(response_owners),
    responses: clone(responses),
    response_listeners: [...response_listeners],
    location_id,
    // A player request for someone to DO something, as structured intent (never executed by
    // conversation). Internal: publicEntry does not project it.
    ...(requested_action ? { requested_action: clone(requested_action) } : {}),
    // Who the player's words addressed (a canonical conversation event): scope direct/subset/group/
    // untargeted, the addressed ids and how the address was established (vocative, greeting, chip,
    // group language, inherited thread). Decided by code, never by wording.
    ...(address ? { address: clone(address) } : {})
  };
  expedition.interaction_history.push(interaction);
  expedition.clock ??= {};
  expedition.clock.communication_ticks = (expedition.clock.communication_ticks ?? 0) + time_cost;
  return clone(interaction);
}

function history(expedition, channel) {
  return (expedition?.interaction_history ?? []).filter((entry) => entry.channel === channel).map(clone);
}

function publicEntry(entry) {
  return {
    id: entry.id,
    submission_id: entry.submission_id ?? null,
    source: entry.source ?? "player",
    channel: entry.channel,
    speaker: entry.speaker,
    targets: entry.targets,
    recipient_type: entry.recipient_type ?? null,
    recipient_id: entry.recipient_id ?? null,
    address_scope: entry.address?.scope ?? null,
    text: entry.player_text,
    attempted_behavior: entry.attempted_behavior,
    eligibility: entry.eligibility,
    delivery: entry.delivery,
    time_cost: entry.time_cost,
    result: entry.presentation.result ?? null,
    response: entry.presentation.response ?? null,
    response_speaker: entry.response_speaker ?? null,
    response_speaker_id: entry.response_speaker_id ?? null,
    response_owners: clone(entry.response_owners ?? []),
    responses: clone(entry.responses ?? [])
  };
}

function updatePresentation(expedition, interactionId, updates = {}) {
  if (!expedition?.interaction_history) return null;
  const interaction = expedition.interaction_history.find((entry) => entry.id === interactionId);
  if (!interaction) return null;
  if (updates.presentation) {
    interaction.presentation = { ...interaction.presentation, ...clone(updates.presentation) };
  }
  if (updates.response !== undefined) {
    interaction.presentation.response = updates.response;
  }
  if (updates.result !== undefined) {
    interaction.presentation.result = updates.result;
  }
  if (updates.response_speaker !== undefined) {
    interaction.response_speaker = updates.response_speaker;
  }
  if (updates.response_speaker_id !== undefined) {
    interaction.response_speaker_id = updates.response_speaker_id;
  }
  if (updates.response_owners !== undefined) {
    interaction.response_owners = clone(updates.response_owners);
  }
  if (updates.responses !== undefined) {
    interaction.responses = clone(updates.responses);
  }
  if (updates.response_listeners !== undefined) {
    interaction.response_listeners = [...updates.response_listeners];
  }
  if (updates.source !== undefined) {
    interaction.presentation.source = updates.source;
  }
  return clone(interaction);
}

module.exports = { VERSION, CHANNELS, record, history, publicEntry, updatePresentation };
