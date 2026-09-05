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
  const matches = [];
  for (const coworker of coworkers) {
    const parts = coworker.label.split(/\s+/).filter(Boolean);
    const options = [coworker.label, parts[0], coworker.role].filter(Boolean);
    const match = options.find((option) => (` ${source} `).includes(` ${normalized(option)} `));
    if (match) matches.push(match);
  }
  return matches.length === 1 ? matches[0] : null;
}

function matchingTarget(text, labels, fallback = null) {
  const source = normalized(text);
  const exact = labels.filter(label => (` ${source} `).includes(` ${normalized(label)} `));
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const partial = labels.filter(label => normalized(label).split(" ").some(term => term.length > 4 && (` ${source} `).includes(` ${term} `)));
  return partial.length === 1 ? partial[0] : partial.length ? null : fallback;
}

function singleAttempt(text, context) {
  const lower = normalized(text);
  const actions = context.sinks?.single_attempt ?? [];
  const coworkers = context.local_coworkers ?? [];
  const attempt = (action, target = null, equipment = null) => proposal([{ actor:{kind:"player"}, action, target_label:target, equipment_label:equipment, agency:/\bi\b/.test(lower) ? "first-person" : "direct-player", language_span:text }]);
  const unavailable = () => proposal([]);
  const available = type => actions.find(action => action.type === type);
  // Resolve the requested verb before considering equipment nouns or movement.
  // An item name cannot grant permission to use it, and an absent target cannot
  // silently select the first route or first item in a list.
  if (/\b(?:give|hand|pass|transfer)\b/.test(lower)) {
    const transfer = available("TRANSFER") ?? available("HANDOFF");
    if (!transfer) return unavailable();
    const equipment = context.local_equipment ?? context.available_equipment ?? [];
    const label = matchingTarget(text, equipment.map(item => item.label));
    const item = equipment.find(item => item.label === label);
    const receiving = /\b(?:give|hand|pass|bring) me\b/.test(lower);
    const recipient = actorReference(text, coworkers) ?? (receiving ? item?.holder : null);
    return recipient && label ? attempt(transfer.type, recipient, label) : unavailable();
  }
  if (/\b(?:head back|take us home|back to the threshold|head toward the threshold|we re done here)\b/.test(lower) || /^(?:please )?(?:let s )?return(?: home)?$/.test(lower)) return available("RETURN") ? attempt("RETURN") : unavailable();
  if (/\b(?:follow me|come with me|regroup)\b/.test(lower)) return available("ORDER_FOLLOW") ? attempt("ORDER_FOLLOW", actorReference(text,coworkers)) : unavailable();
  if (/\b(?:stay|hold|wait)\b/.test(lower)) {
    const recipient = actorReference(text,coworkers);
    const teamOrder = recipient || /\b(?:everyone|everybody|team|all|hold up|stay here)\b/.test(lower);
    return teamOrder && available("ORDER_HOLD") ? attempt("ORDER_HOLD",recipient) : available("WAIT") ? attempt("WAIT") : unavailable();
  }
  if (/\b(?:look around|look at the ceiling|take stock|take a closer look|what s over there)\b/.test(lower) || /^(?:please )?(?:i )?(?:look|observe|orient)$/.test(lower)) return available("LOOK") ? attempt("LOOK") : unavailable();
  if (/\b(?:inspect|check|examine)\b/.test(lower)) {
    const inspect = available("INSPECT");
    return inspect ? attempt("INSPECT",matchingTarget(text,inspect.target_labels)) : unavailable();
  }
  if (/\b(?:photograph|photo|picture|snapshot)\b/.test(lower)) {
    const photo = available("PHOTOGRAPH");
    if (!photo) return unavailable();
    const targets = photo.target_labels.filter(label => !/ — /.test(label));
    const target = matchingTarget(text,targets) ?? (targets.length===1 ? targets[0] : null);
    return attempt("PHOTOGRAPH",target);
  }
  if (/\b(?:measure|reading|use)\b/.test(lower)) {
    const use = available("USE");
    const target = use && (matchingTarget(text,use.target_labels) ?? use.target_labels.find(label=>/survey|instrument/i.test(label)));
    return use && target ? attempt("USE",target) : unavailable();
  }
  if (/\b(?:walk|go|move|head|proceed|keep moving|keep walking|return to|take the)\b/.test(lower)) {
    const movement = available("MOVE");
    if (!movement) return unavailable();
    if (/\b(?:left|right)\b/.test(lower)) return unavailable();
    if (/\b(?:go back|previous room|backtrack)\b/.test(lower)) return attempt("MOVE",context.previous_exit);
    const direction = lower.match(/\b(northwest|northeast|southwest|southeast|north|south|east|west|back|forward|up|down)\b/)?.[1];
    const directional = direction && movement.target_labels.filter(label=>normalized(label).startsWith(direction+" "));
    const query = lower.replace(/\bhall(?:way)?\b/g,"corridor");
    const target = directional?.length===1 ? directional[0] : matchingTarget(query,movement.target_labels);
    return attempt("MOVE",target);
  }
  return unavailable();
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
      return singleAttempt(text, context);
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
