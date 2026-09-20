"use strict";

const VERSION = "yellow-beast-q4-interaction-envelope@v1";
const CHANNELS = Object.freeze(["action", "local", "standard"]);
const clone = (value) => structuredClone(value);

function record(expedition, { channel, speaker = "You", speaker_id = null, targets = [], recipient_ids = [], listeners = [], player_text = null, attempted_behavior = null, eligibility = "eligible", delivery = "not-applicable", time_cost = 0, canonical_effects = [], observer_knowledge = [], presentation = {}, response_speaker = null, response_speaker_id = null, response_listeners = [], location_id = null, submission_id = null }) {
  if (!expedition || !CHANNELS.includes(channel)) throw new Error("Q4 interaction requires a supported channel");
  expedition.interaction_history ??= [];
  const interaction = {
    version: VERSION,
    id: `q4-interaction-${expedition.interaction_history.length + 1}`,
    submission_id,
    channel,
    speaker,
    speaker_id,
    targets: [...targets],
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
    response_listeners: [...response_listeners],
    location_id
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
    channel: entry.channel,
    speaker: entry.speaker,
    targets: entry.targets,
    text: entry.player_text,
    attempted_behavior: entry.attempted_behavior,
    eligibility: entry.eligibility,
    delivery: entry.delivery,
    time_cost: entry.time_cost,
    result: entry.presentation.result ?? null,
    response: entry.presentation.response ?? null,
    response_speaker: entry.response_speaker ?? null
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
  if (updates.response_listeners !== undefined) {
    interaction.response_listeners = [...updates.response_listeners];
  }
  if (updates.source !== undefined) {
    interaction.presentation.source = updates.source;
  }
  return clone(interaction);
}

module.exports = { VERSION, CHANNELS, record, history, publicEntry, updatePresentation };
