"use strict";

const { PROPOSAL_VERSION } = require("./ai-interpreter-boundary");
const { PRESENTATION_VERSION, visibleActionText } = require("./ai-living-turn");

function normalized(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function proposal(attempts, relation = "single") {
  return { version: PROPOSAL_VERSION, status: "proposal", noncanonical: true, relation, attempts };
}

function actorReference(text, coworkers) {
  const source = normalized(text);
  for (const coworker of coworkers) {
    const parts = coworker.label.split(/\s+/).filter(Boolean);
    const options = [coworker.label, parts[0], coworker.role].filter(Boolean);
    const match = options.find((option) => source.includes(normalized(option)));
    if (match) return match;
  }
  return null;
}

function matchingTarget(text, labels, fallback = null) {
  const source = normalized(text);
  return labels.find((label) => source.includes(normalized(label)))
    ?? labels.find((label) => normalized(label).split(" ").some((term) => term.length > 4 && source.includes(term)))
    ?? fallback;
}

function createLivingProvider() {
  return {
    name: "deterministic-living-provider",
    async interpret({ player_text, context }) {
      const text = String(player_text);
      const lower = normalized(text);
      const coworkers = context.local_coworkers ?? [];
      const coordinated = context.sinks?.coordinated_attempt ?? {};
      if (/\bwhile\b/.test(lower) && /\bi\b/.test(lower) && /\bmeasure|measurement|reading\b/.test(lower)) {
        const reference = actorReference(text, coworkers);
        const coworkerAction = coordinated.coworker_actions?.[0];
        const playerAction = coordinated.player_actions?.[0];
        if (reference && coworkerAction && playerAction) {
          const halves = text.split(/\bwhile\b/i);
          const coworkerSpan = halves[0].trim().replace(/[,.]+$/, "");
          const playerSpan = `I ${halves.slice(1).join(" while ").trim().replace(/^i\s+/i, "")}`;
          return proposal([
            { actor: { kind: "coworker", reference }, action: coworkerAction.type, target_label: matchingTarget(coworkerSpan, coworkerAction.target_labels), equipment_label: null, agency: "player-order", language_span: coworkerSpan },
            { actor: { kind: "player" }, action: playerAction.type, target_label: playerAction.target_labels[0] ?? null, equipment_label: playerAction.equipment_labels[0] ?? null, agency: "first-person", language_span: playerSpan }
          ], "coordinated");
        }
      }
      const actions = context.sinks?.single_attempt ?? [];
      const movement = actions.find((action) => action.type === "MOVE");
      if (movement && /\b(?:walk|go|move|proceed|keep walking)\b/.test(lower)) {
        const target = matchingTarget(text, movement.target_labels, movement.target_labels.find((label) => /passage/i.test(label)) ?? null);
        return proposal([{ actor: { kind: "player" }, action: "MOVE", target_label: target, equipment_label: null, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
      }
      const inspection = actions.find((action) => action.type === "INSPECT");
      if (inspection && /\b(?:inspect|check|examine)\b/.test(lower)) {
        return proposal([{ actor: { kind: "player" }, action: "INSPECT", target_label: matchingTarget(text, inspection.target_labels), equipment_label: null, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
      }
      return { version: PROPOSAL_VERSION, status: "proposal", noncanonical: true, relation: "single", attempts: [] };
    },
    async present(providerPacket) {
      const packet = providerPacket.player_scene;
      const parts = [];
      if (packet.location.visible_description) parts.push(packet.location.visible_description);
      if (providerPacket.authoritative_resolution.public_reason) parts.push(providerPacket.authoritative_resolution.public_reason);
      for (const event of packet.recent_observable_events ?? []) if (event.actor_id !== packet.observer_id) parts.push(visibleActionText(packet, event));
      return { version: PRESENTATION_VERSION, scene_description: parts.join(" ") || "The interval produces no further confirmed change.", npc_presentations: [], presentation_claims: [] };
    }
  };
}

module.exports = { createLivingProvider };
