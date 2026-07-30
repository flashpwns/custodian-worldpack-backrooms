"use strict";

function firstAlias(context) { return context.aliases[0]?.alias; }
function mockIntent({ player_text, context }) {
  const input = player_text.toLowerCase();
  if (input.includes("ignore") || input.includes("hidden") || input.includes("behind every wall") || input.includes("teleport")) return { kind: "invalid", actions: [], clarification: null, public_reason: "That request cannot be resolved from your current view." };
  if (input.includes("malformed")) return { kind: "action", actions: [{ verb: "OPEN", target_alias: "hidden-room" }], clarification: null, injected: true };
  if (input.includes("provider failure")) throw new Error("mock provider unavailable");
  const fixture = firstAlias(context);
  if (input.includes("door") && context.aliases.length > 1) return { kind: "clarification", actions: [], clarification: { message: "Which visible door do you mean?", candidates: context.aliases.map(({ alias }) => alias) } };
  if ((input.includes("hall") || input.includes("corridor")) && (input.includes("inspect") || input.includes("look at")) && fixture) return { kind: "compound", actions: [{ verb: "MOVE", parameters: {} }, { verb: "INSPECT", target_alias: fixture, parameters: {} }], clarification: null };
  if (input.includes("use")) return { kind: "action", actions: [{ verb: "USE", parameters: {} }], clarification: null };
  if (input.includes("look")) return { kind: "action", actions: [{ verb: "LOOK", parameters: {} }], clarification: null };
  if (input.includes("inspect") || input.includes("check") || input.includes("fixture") || input.includes("light")) return fixture ? { kind: "action", actions: [{ verb: "INSPECT", target_alias: fixture, parameters: {} }], clarification: null } : { kind: "clarification", actions: [], clarification: { message: "There is no visible inspection target yet.", candidates: [] } };
  if (input.includes("move") || input.includes("head") || input.includes("walk") || input.includes("corridor") || input.includes("hall")) return { kind: "action", actions: [{ verb: "MOVE", parameters: {} }], clarification: null };
  return { kind: "invalid", actions: [], clarification: null, public_reason: "I could not map that to an available action." };
}
function mockNarration({ envelope }) {
  if (envelope.outcome === "succeeded") return { text: `${envelope.verb}: completed from your current view.` };
  return { text: `${envelope.verb}: ${envelope.public_reason ?? "unavailable"}.` };
}
function createMockProvider() { return { name: "deterministic-mock", interpret: mockIntent, narrate: mockNarration }; }
module.exports = { createMockProvider };
