"use strict";

const VERSION = "yellow-beast-q4-interaction-envelope@v1";
const CHANNELS = Object.freeze(["action", "local", "standard"]);
const clone = (value) => structuredClone(value);

function record(expedition, { channel, speaker = "You", targets = [], player_text = null, attempted_behavior = null, eligibility = "eligible", delivery = "not-applicable", time_cost = 0, canonical_effects = [], observer_knowledge = [], presentation = {} }) {
  if (!expedition || !CHANNELS.includes(channel)) throw new Error("Q4 interaction requires a supported channel");
  expedition.interaction_history ??= [];
  const interaction = {
    version: VERSION,
    id: `q4-interaction-${expedition.interaction_history.length + 1}`,
    channel,
    speaker,
    targets: [...targets],
    player_text,
    attempted_behavior,
    eligibility,
    delivery,
    time_cost,
    canonical_effects: [...canonical_effects],
    observer_knowledge: clone(observer_knowledge),
    presentation: clone(presentation)
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
    response: entry.presentation.response ?? null
  };
}

module.exports = { VERSION, CHANNELS, record, history, publicEntry };
