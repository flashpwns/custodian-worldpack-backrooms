"use strict";

const { PROPOSAL_VERSION } = require("./ai-interpreter-boundary");
const { PRESENTATION_VERSION, visibleActionText } = require("./ai-living-turn");

function normalized(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function distinct(items) {
  return [...new Set((items ?? []).filter(Boolean))];
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
      // Coordinated multi-clause parsing
      const coordCoworkerActions = coordinated.coworker_actions ?? [];
      const coordPlayerActions = coordinated.player_actions ?? [];
      const availableTargets = distinct([
        ...(context.visible_targets ?? []),
        ...((context.sinks?.single_attempt ?? []).flatMap((a) => a.target_labels ?? [])),
        ...(coordCoworkerActions.flatMap((a) => a.target_labels ?? [])),
        ...(coordPlayerActions.flatMap((a) => a.target_labels ?? []))
      ]);

      let clauses = null;
      const leadingWhile = /^(?:while|whilst|as)\s+([^,]+),\s*(.+)$/i.exec(text);
      if (leadingWhile) {
        clauses = [leadingWhile[1].trim(), leadingWhile[2].trim()];
      } else {
        const midWhile = /^(.+?)\s+\b(?:while|whilst)\b\s+(.+)$/i.exec(text);
        if (midWhile) {
          clauses = [midWhile[1].trim(), midWhile[2].trim()];
        } else {
          const andMatch = /^(.+?)\s+(?:,\s*)?and\s+(.+)$/i.exec(text);
          if (andMatch) {
            const left = andMatch[1].trim();
            const right = andMatch[2].trim();
            if (/\b(?:inspect|check|examine|look|photograph|photo|picture|camera|test|meter|measure|use|move|walk)\b/i.test(right) || coworkers.some((c) => normalized(right).includes(normalized(c.label.split(/\s+/)[0])))) {
              clauses = [left, right];
            }
          }
        }
      }

      if (clauses && clauses.length === 2 && coworkers.length > 0) {
        const c1Ref = actorReference(clauses[0], coworkers);
        const c2Ref = actorReference(clauses[1], coworkers);
        const overallRef = actorReference(text, coworkers);
        const hasCoworker = Boolean(c1Ref || c2Ref || overallRef);

        if (hasCoworker) {
          const c1IsCoworker = Boolean(c1Ref) || (!c2Ref && Boolean(overallRef) && !/\b(i|me)\b/i.test(clauses[0]) && /\b(i|me)\b/i.test(clauses[1]));
          const coworkerClause = c1IsCoworker ? clauses[0] : clauses[1];
          const playerClause = c1IsCoworker ? clauses[1] : clauses[0];
          const coworkerRef = (c1IsCoworker ? c1Ref : c2Ref) ?? overallRef;

          // Remove coworker names from target search so teammates are not misidentified as targets
          let coworkerSearchClause = coworkerClause;
          let playerSearchClause = playerClause;
          for (const cw of coworkers) {
            const parts = cw.label.split(/\s+/).filter(Boolean);
            for (const part of [cw.label, ...parts, cw.role]) {
              if (part && part.length > 2) {
                const re = new RegExp(`\\b${part.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "gi");
                coworkerSearchClause = coworkerSearchClause.replace(re, " ");
                playerSearchClause = playerSearchClause.replace(re, " ");
              }
            }
          }

          // Resolve targets, supporting cross-clause pronoun reference ("it")
          let playerExplicitTarget = matchingTarget(playerSearchClause, availableTargets);
          let coworkerExplicitTarget = matchingTarget(coworkerSearchClause, availableTargets);
          if (!playerExplicitTarget && coworkerExplicitTarget && /\b(?:it|them|this|that)\b/i.test(normalized(playerClause))) {
            playerExplicitTarget = coworkerExplicitTarget;
          }
          if (!coworkerExplicitTarget && playerExplicitTarget && /\b(?:it|them|this|that)\b/i.test(normalized(coworkerClause))) {
            coworkerExplicitTarget = playerExplicitTarget;
          }

          // Player attempt
          let playerActionType = "INSPECT";
          let playerTarget = playerExplicitTarget;
          let playerEquipment = null;
          if (/\b(?:measure(?:s|ed|ing)?|reading(?:s)?|instrument)\b/i.test(normalized(playerClause))) {
            playerActionType = "USE";
            const useSink = coordPlayerActions.find((a) => a.type === "USE");
            playerTarget = useSink?.target_labels?.[0] ?? playerExplicitTarget ?? "open passage";
            playerEquipment = useSink?.equipment_labels?.[0] ?? "survey instrument";
          } else if (/\b(?:photograph(?:s|ed|ing)?|photos?|pictures?|camera|snapshots?)\b/i.test(normalized(playerClause))) {
            playerActionType = "PHOTOGRAPH";
          } else if (/\b(?:test(?:s|ed|ing)?|meter(?:s|ed|ing)?)\b/i.test(normalized(playerClause))) {
            playerActionType = "TEST";
          } else if (/\b(?:move|walk|go|proceed)\b/i.test(normalized(playerClause))) {
            playerActionType = "MOVE";
            const moveSink = (context.sinks?.single_attempt ?? []).find((a) => a.type === "MOVE");
            playerTarget = matchingTarget(playerClause, moveSink?.target_labels ?? availableTargets);
          } else {
            playerActionType = "INSPECT";
          }

          const playerAttempt = {
            actor: { kind: "player" },
            action: playerActionType,
            target_label: playerTarget,
            equipment_label: playerEquipment,
            agency: /\b(i|me)\b/i.test(normalized(playerClause)) ? "first-person" : "direct-player",
            language_span: playerClause.trim().replace(/^[,.\s]+|[,.\s]+$/g, "")
          };

          // Coworker attempt
          let coworkerActionType = "INSPECT";
          let coworkerTarget = coworkerExplicitTarget;
          let coworkerEquipment = null;
          if (/\b(?:photograph(?:s|ed|ing)?|photos?|pictures?|camera|snapshots?)\b/i.test(normalized(coworkerClause))) {
            coworkerActionType = "PHOTOGRAPH";
          } else if (/\b(?:measure(?:s|ed|ing)?|reading(?:s)?|instrument)\b/i.test(normalized(coworkerClause))) {
            coworkerActionType = "USE";
            const useSink = coordCoworkerActions.find((a) => a.type === "USE");
            coworkerTarget = useSink?.target_labels?.[0] ?? coworkerExplicitTarget ?? "open passage";
            coworkerEquipment = "survey instrument";
          } else if (/\b(?:test(?:s|ed|ing)?|meter(?:s|ed|ing)?)\b/i.test(normalized(coworkerClause))) {
            coworkerActionType = "TEST";
          } else if (/\b(?:stay|hold|wait)\b/i.test(normalized(coworkerClause))) {
            coworkerActionType = "ORDER_HOLD";
          } else if (/\b(?:follow|regroup|come with)\b/i.test(normalized(coworkerClause))) {
            coworkerActionType = "ORDER_FOLLOW";
          } else {
            coworkerActionType = "INSPECT";
          }

          const coworkerAttempt = {
            actor: { kind: "coworker", reference: coworkerRef },
            action: coworkerActionType,
            target_label: coworkerTarget,
            equipment_label: coworkerEquipment,
            agency: "player-order",
            language_span: coworkerClause.trim().replace(/^[,.\s]+|[,.\s]+$/g, "")
          };

          const attempts = c1IsCoworker
            ? [coworkerAttempt, playerAttempt]
            : [playerAttempt, coworkerAttempt];

          return proposal(attempts, "coordinated");
        }
      }
      const actions = context.sinks?.single_attempt ?? [];
      const movement = actions.find((action) => action.type === "MOVE");
      if (movement && /\b(?:walk|go|move|proceed|keep walking)\b/.test(lower)) {
        const target = matchingTarget(text, movement.target_labels, movement.target_labels.find((label) => /passage/i.test(label)) ?? null);
        return proposal([{ actor: { kind: "player" }, action: "MOVE", target_label: target, equipment_label: null, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
      }
      const photoAction = actions.find((action) => action.type === "PHOTOGRAPH");
      if (photoAction && /\b(?:photograph|photo|picture|camera|snapshot)\b/.test(lower)) {
        const target = matchingTarget(text, photoAction.target_labels) ?? photoAction.target_labels[0];
        return proposal([{ actor: { kind: "player" }, action: "PHOTOGRAPH", target_label: target, equipment_label: null, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
      }
      const transferAction = actions.find((action) => action.type === "TRANSFER" || action.type === "HANDOFF");
      if (transferAction && /\b(?:give|hand|pass|transfer)\b/.test(lower)) {
        const recipient = actorReference(text, coworkers);
        const equipLabel = (context.available_equipment ?? []).find((eq) => lower.includes(normalized(eq.label)) || normalized(eq.label).split(" ").some((term) => term.length > 4 && lower.includes(term)))?.label ?? (context.available_equipment?.[0]?.label ?? null);
        if (recipient && equipLabel) {
          return proposal([{ actor: { kind: "player" }, action: transferAction.type, target_label: recipient, equipment_label: equipLabel, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
        }
      }
      const holdOrder = actions.find((action) => action.type === "ORDER_HOLD");
      if (holdOrder && /\b(?:stay|hold|wait)\b/.test(lower)) {
        const recipient = actorReference(text, coworkers);
        return proposal([{ actor: { kind: "player" }, action: "ORDER_HOLD", target_label: recipient, equipment_label: null, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
      }
      const followOrder = actions.find((action) => action.type === "ORDER_FOLLOW");
      if (followOrder && /\b(?:follow|regroup|come with)\b/.test(lower)) {
        const recipient = actorReference(text, coworkers);
        return proposal([{ actor: { kind: "player" }, action: "ORDER_FOLLOW", target_label: recipient, equipment_label: null, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
      }
      const useAction = actions.find((action) => action.type === "USE");
      if (useAction && /\b(?:measure|reading|instrument)\b/.test(lower)) {
        const target = useAction.target_labels.find((l) => /survey|instrument/i.test(l)) ?? useAction.target_labels[0];
        return proposal([{ actor: { kind: "player" }, action: "USE", target_label: target, equipment_label: null, agency: /\bi\b/.test(lower) ? "first-person" : "direct-player", language_span: text }]);
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
      for (const event of packet.recent_observable_events ?? []) parts.push(visibleActionText(packet, event));
      return { version: PRESENTATION_VERSION, scene_description: parts.join(" ") || "The interval produces no further confirmed change.", npc_presentations: [], presentation_claims: [] };
    }
  };
}

module.exports = { createLivingProvider };
