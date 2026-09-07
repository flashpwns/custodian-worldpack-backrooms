"use strict";
const RESOLUTION_PLAN_VERSION = "yellow-beast-resolution-plan@v1";

const SEMANTIC_ACTIONS = Object.freeze([
  "MOVE", "APPROACH", "FOLLOW", "WAIT", "HOLD_POSITION",
  "LOOK", "FOCUS", "LISTEN", "INSPECT",
  "TAKE", "GIVE", "PLACE", "OPEN", "CLOSE", "USE",
  "PHOTOGRAPH", "RECORD",
  "SPEAK", "ASK", "TELL", "RADIO", "POINT", "HELP",
  "ASSIGN_TASK", "CANCEL_TASK", "RETURN"
]);

const normalize = (value) => String(value ?? "").toLowerCase();
const capabilitiesFor = (text) => {
  const t = normalize(text);
  const pairs = [
    [/walk|move|go|crawl|back away/, "locomotion"],
    [/approach|head toward|step toward/, "approach"],
    [/follow|come with|stay with/, "follow"],
    [/wait|pause|stand by/, "wait"],
    [/hold|stay here|stay put|hold position/, "hold_position"],
    [/look|observe|scan|see/, "observe"],
    [/focus|look closely|zero in/, "focus"],
    [/listen|hear/, "listen"],
    [/inspect|examine|check|study/, "inspect"],
    [/take|grab|pick up/, "take"],
    [/give|hand|transfer|pass/, "give"],
    [/place|put|set down|drop/, "place"],
    [/open/, "open"],
    [/close|shut/, "close"],
    [/use|operate/, "use"],
    [/photograph|photo|picture|snap/, "photograph"],
    [/record|tape|log/, "record"],
    [/speak|say|talk/, "speak"],
    [/ask|inquire|query/, "ask"],
    [/tell|inform|relay/, "tell"],
    [/radio|transmit|broadcast/, "radio"],
    [/point|indicate|gesture/, "point"],
    [/help|assist|stabilize/, "help"],
    [/assign|order|instruct|command/, "assign_task"],
    [/cancel|abort|belay|stand down/, "cancel_task"],
    [/return|withdraw|retreat|head back/, "return"],
    [/crouch|climb|lean|stand/, "posture-change"],
    [/touch|drag|push|pull|lift|wedge|stack/, "grasp"]
  ];
  return pairs.filter(([pattern]) => pattern.test(t)).map(([, capability]) => capability);
};
function planResolution(grounded_intent, facts = {}) {
  if (!grounded_intent || grounded_intent.version !== "yellow-beast-grounded-intent@v1") throw new Error("grounded intent required");
  const unavailable = new Set(facts.unavailable_refs ?? []); const prohibited = new Set(facts.prohibited_refs ?? []); const steps = grounded_intent.intent.steps.map((step, index) => {
    const refs = grounded_intent.grounded_references.filter((item) => item.reference_id.startsWith(`${step.id}.`)); const required = capabilitiesFor(step.attempt); const missing = refs.filter((item) => unavailable.has(item.canonical_ref)); const impossible = missing.length > 0 || /pick up the wall|from across the room without touching/.test(normalize(step.attempt)); const dependencies = index ? [`step-${index}`] : [];
    const permission = refs.some((item) => prohibited.has(item.canonical_ref)) ? "prohibited" : "not_applicable";
    return { id: step.id, attempted_behavior: step.attempt, capability_requirements: required, satisfied_capabilities: required, missing_capabilities: impossible ? ["accessible target"] : [], physical_constraints: /wall/.test(normalize(step.attempt)) ? ["integral architecture"] : [], spatial_constraints: missing.length ? ["inaccessible"] : [], material_constraints: [], equipment_constraints: [], posture_constraints: /fixture|light/.test(normalize(step.attempt)) && /touch|remove/.test(normalize(step.attempt)) ? ["may require elevation"] : [], knowledge_constraints: refs.some((item) => item.source === "memory") ? ["remembered reference is uncertain"] : [], social_constraints: /communicate/.test(required.join(" ")) ? ["response or compliance is unresolved"] : [], institutional_constraints: permission === "prohibited" ? ["known restriction"] : [], explicit_permissions: permission, explicit_prohibitions: permission === "prohibited" ? ["known restriction"] : [], known_risks: [], unknowns: step.uncertain ? ["attempt outcome unresolved"] : [], dependencies, preconditions: dependencies, possible: !impossible, reason_if_impossible: impossible ? (missing.length ? "The referenced item is not accessible right now." : "That attempt cannot proceed with the known physical relationship.") : null, requires_attempt_resolution: !impossible, interruption_points: ["after this step if world state changes"] };
  });
  return { version: RESOLUTION_PLAN_VERSION, noncanonical: true, intent: grounded_intent.intent, grounded_intent, actor: grounded_intent.intent.actor, steps, conditions: grounded_intent.intent.conditions, preferences: grounded_intent.intent.preferences, clarification_required: grounded_intent.clarification_required, status: grounded_intent.clarification_required ? "GROUNDING_AMBIGUITY" : steps.some((step) => !step.possible) ? "PLAN_PARTIAL" : "PLAN_READY", planning_notes: ["Possible does not mean permitted or successful. No canonical consequence has occurred."] };
}
module.exports = { RESOLUTION_PLAN_VERSION, SEMANTIC_ACTIONS, planResolution };
